import { ClientError, ResponseError, TransportError } from '@astrale-os/sdk/client'
import chalk from 'chalk'

import type { InstanceInfo } from '../admin/instance'
import type { KernelCommandOpts } from '../connection'
import type { AdminTargetCommandOpts } from './admin-target'
import type { ImportedInstanceRootIdentity } from './instance-root-identity'

import { AstraleError, AuthError } from '../errors'
import { readIdentities, type IdentityStore } from '../identity/index'
import { createOwnedInstance } from './admin-instance'
import { randomOperationId } from './idempotency'
import { setActive, upsertManagedBookmark } from './instance'
import { importInstanceRootIdentity } from './instance-root-identity'
import { withSpinner } from './log'
import { isMachine } from './output'
import { validateSlug } from './validation'

export type ProvisionOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    // Programmatic opt-out for callers that drive this command as a function.
    // The matching CLI flags are read from argv by `canPrompt` — Commander
    // keeps root options out of a subcommand's action arguments.
    ci?: boolean
    noPrompt?: boolean
  }

/** The created instance plus the local-bookmark side effects of provisioning. */
export type ProvisionResult = {
  /** The raw admin-kernel response — the stable machine surface for `--json`. */
  created: InstanceInfo
  slug: string
  /** Set when an existing bookmark of the same name was repointed to a new kernel. */
  repointedFrom?: string
  /** Set when bookmarking/activating the new instance failed (non-fatal). */
  selectionError?: unknown
  /** Imported root identity; absent when best-effort recovery failed. */
  rootIdentity?: ImportedInstanceRootIdentity
  /** Root recovery is deliberately non-fatal to successful provisioning. */
  rootIdentityError?: unknown
}

/** Provisioning a child instance runs a multi-step saga. */
const SAGA_TIMEOUT_MS = '120000'
const PROVISION_WINDOW_MS = 10 * 60_000
const RETRY_DELAY_MS = 1_000

interface ProvisionDependencies {
  readonly createOwnedInstance: typeof createOwnedInstance
  readonly upsertManagedBookmark: typeof upsertManagedBookmark
  readonly setActive: typeof setActive
  readonly importInstanceRootIdentity: typeof importInstanceRootIdentity
  readonly operationId: () => string
  readonly now: () => number
  readonly sleep: (milliseconds: number) => Promise<void>
}

const provisionDefaults: ProvisionDependencies = {
  createOwnedInstance,
  upsertManagedBookmark,
  setActive,
  importInstanceRootIdentity,
  operationId: () => randomOperationId('cli', 'instance', 'create'),
  now: Date.now,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}

/**
 * Provision an instance through the admin kernel, then bookmark it and
 * make it the active target. Extracted from `instance create` so `astrale
 * setup` provisions through the exact same saga (auth assertion → create →
 * bookmark → set-active).
 *
 * Presentation is deliberately minimal here (a spinner + a one-line success);
 * the caller renders anything richer — `setup` follows this with a hero panel.
 */
export async function provisionInstance(
  slug: string,
  opts: ProvisionOpts,
  dependencies: Partial<ProvisionDependencies> = {},
): Promise<ProvisionResult> {
  const deps = { ...provisionDefaults, ...dependencies }
  validateSlug(slug)
  const authentication = await instanceCreateAuthentication(opts)
  opts = authentication.opts

  const machine = isMachine(opts)
  let repointedFrom: string | undefined
  let selectionError: unknown = null
  // Keep each Workflow invocation inside the platform's request window. The
  // same durable operation is replayed when Admin returns a provisioning receipt.
  const createOpts = instanceCreateOptions(opts)
  const operationId = deps.operationId()
  const deadline = deps.now() + PROVISION_WINDOW_MS

  const runProvision = () =>
    withSpinner(
      `Provisioning instance ${slug}`,
      !machine,
      async () => {
        let pending: InstanceInfo | undefined
        let created: InstanceInfo
        while (true) {
          if (pending !== undefined && deps.now() >= deadline) return pending
          try {
            created = await deps.createOwnedInstance(createOpts, slug, operationId)
          } catch (error) {
            if (!retryableCreate(error) || deps.now() >= deadline) {
              if (pending !== undefined) return pending
              throw error
            }
            await deps.sleep(RETRY_DELAY_MS)
            continue
          }
          if (created.state === 'ready') break
          if (created.state !== 'provisioning') {
            throw new AstraleError(
              'INSTANCE_PROVISION_FAILED',
              created.error ?? `Instance ${JSON.stringify(slug)} is ${created.state}.`,
              'Run `astrale instance list` to inspect it.',
            )
          }
          pending = created
          if (deps.now() >= deadline) return created
          await deps.sleep(RETRY_DELAY_MS)
        }
        try {
          // Org id from the create response — authoritative for token scoping
          // (the router's /auth/org is eventually consistent).
          const bookmarked = await deps.upsertManagedBookmark({
            key: slug,
            slug,
            url: created.url,
            ...(created.organizationId ? { organizationId: created.organizationId } : {}),
            ...(authentication.defaultIdentity
              ? { defaultIdentity: authentication.defaultIdentity }
              : {}),
          })
          repointedFrom = bookmarked.repointedFrom
          await deps.setActive(slug)
        } catch (e) {
          selectionError = e
        }
        return created
      },
      {
        success: (created) =>
          created.state === 'ready'
            ? `Instance provisioned: ${slug} ${chalk.dim(`(${created.url})${selectionError ? '' : ' · active'}`)}`
            : `Instance provisioning continues: ${slug} ${chalk.dim(`(${created.phase ?? 'pending'} · ${created.operationId ?? operationId})`)}`,
      },
    )

  const created = await runProvision()
  if (created.state !== 'ready') return { created, slug }
  let rootIdentity: ImportedInstanceRootIdentity | undefined
  let rootIdentityError: unknown
  try {
    rootIdentity = await withSpinner(
      `Importing root identity for ${slug}`,
      !machine,
      () => deps.importInstanceRootIdentity(createOpts, created.id, { bookmark: false }),
      { success: (result) => `Root identity imported: ${result.name}` },
    )
  } catch (error) {
    rootIdentityError = error
  }

  // Warnings go to stderr so machine-readable stdout stays clean.
  const warn = (msg: string) => console.error(chalk.yellow('⚠'), msg)
  if (selectionError) {
    const message =
      selectionError instanceof Error ? selectionError.message : String(selectionError)
    warn(`Could not select the new instance: ${message}`)
  } else if (repointedFrom) {
    warn(`Bookmark "${slug}" repointed: ${repointedFrom} → ${created.url}`)
  }
  if (rootIdentityError !== undefined) {
    const message =
      rootIdentityError instanceof Error ? rootIdentityError.message : String(rootIdentityError)
    warn(`Could not import the Instance root identity: ${message}`)
    warn(`Recover it later with: astrale instance root import ${slug}`)
  }

  return {
    created,
    slug,
    repointedFrom,
    ...(selectionError ? { selectionError } : {}),
    ...(rootIdentity === undefined ? {} : { rootIdentity }),
    ...(rootIdentityError === undefined ? {} : { rootIdentityError }),
  }
}

export function instanceCreateOptions(opts: ProvisionOpts): ProvisionOpts {
  return { ...opts, timeout: opts.timeout ?? SAGA_TIMEOUT_MS }
}

function retryableCreate(error: unknown): boolean {
  if (error instanceof TransportError) return true
  if (error instanceof ResponseError) return error.code === 5000
  if (!(error instanceof ClientError)) return false
  const failure = (error as ClientError & { readonly failure?: unknown }).failure
  return failure === 'timeout' || failure === 'closed'
}

async function instanceCreateAuthentication(opts: ProvisionOpts): Promise<{
  readonly opts: ProvisionOpts
  readonly defaultIdentity?: string
}> {
  if (opts.creds) return { opts }
  const store = await readIdentities()
  const defaultIdentity = selectInstanceCreateIdentity(store, opts)
  return {
    opts: opts.as ? opts : { ...opts, as: defaultIdentity },
    defaultIdentity,
  }
}

export function selectInstanceCreateIdentity(
  store: IdentityStore,
  opts: Pick<ProvisionOpts, 'as'> = {},
): string {
  assertInstanceCreateIdentity(store, opts)
  return opts.as ?? store.default
}

export function assertInstanceCreateIdentity(
  store: IdentityStore,
  opts: Pick<ProvisionOpts, 'as'> = {},
): void {
  const name = opts.as ?? store.default
  const identity = store.identities[name]
  if (identity && identity.source === 'idp') return
  throw new AuthError(
    'WorkOS login required for `astrale instance create`',
    'Run: astrale auth login',
  )
}
