import { ClientError, ResponseError, TransportError } from '@astrale-os/sdk/client'
import chalk from 'chalk'

import type { InstanceInfo } from '../admin/instance'
import type { KernelCommandOpts } from '../connection'
import type { AdminTargetCommandOpts } from './admin-target'
import type { ImportedInstanceRootIdentity } from './instance-root-identity'

import { formatKernelError } from '../connection/errors'
import { AstraleError, AuthError } from '../errors'
import { readIdentities, type IdentityStore } from '../identity/index'
import { activateInstance, type InstanceActivation } from './activate-instance'
import { createOwnedInstance } from './admin-instance'
import { randomOperationId } from './idempotency'
import { bookmarkCreatedInstance } from './instance'
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
    /** Exact durable create operation to replay after an uncertain outcome. */
    operation?: string
  }

/** The created instance plus the local-bookmark side effects of provisioning. */
export type ProvisionResult = {
  /** The raw admin-kernel response — the stable machine surface for `--json`. */
  created: InstanceInfo
  slug: string
  /** Local bookmarking is separate from the ready receipt and verified human access. */
  bookmark?:
    | { readonly status: 'completed'; readonly name: string }
    | {
        readonly status: 'pending'
        readonly code: string
        readonly message: string
        readonly hint?: string
      }
  /** Imported root identity; absent when best-effort recovery failed. */
  rootIdentity?: ImportedInstanceRootIdentity
  /** Root recovery is deliberately non-fatal to successful provisioning. */
  rootIdentityError?: unknown
  /** Human access is independent of provisioning and optional root recovery. */
  access?: InstanceActivation | { readonly status: 'pending'; readonly code: string }
}

/** Provisioning a child instance runs a multi-step saga. */
const SAGA_TIMEOUT_MS = '120000'
const PROVISION_WINDOW_MS = 10 * 60_000
const RETRY_DELAY_MS = 1_000
const INSTANCE_CREATE_OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u

interface ProvisionDependencies {
  readonly createOwnedInstance: typeof createOwnedInstance
  readonly bookmarkCreatedInstance: typeof bookmarkCreatedInstance
  readonly importInstanceRootIdentity: typeof importInstanceRootIdentity
  readonly activateInstance: typeof activateInstance
  readonly operationId: () => string
  readonly now: () => number
  readonly sleep: (milliseconds: number) => Promise<void>
}

const provisionDefaults: ProvisionDependencies = {
  createOwnedInstance,
  bookmarkCreatedInstance,
  importInstanceRootIdentity,
  activateInstance,
  operationId: () => randomOperationId('cli', 'instance', 'create'),
  now: Date.now,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}

/**
 * Resume Admin's creation receipt, finalize and verify the owner's child access,
 * then bookmark it, selecting it only when no target exists. Setup uses this same journey.
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
  let bookmark: ProvisionResult['bookmark']
  // Keep each Workflow invocation inside the platform's request window. The
  // same durable operation is replayed when Admin returns a provisioning receipt.
  let createOpts = instanceCreateOptions(opts)
  const operationId =
    opts.operation === undefined
      ? deps.operationId()
      : acceptInstanceCreateOperationId(opts.operation)
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
            created = await deps.createOwnedInstance(createOpts, slug, operationId, (fleet) => {
              createOpts = { ...createOpts, fleet }
            })
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
              `Retry with --operation ${created.operationId ?? operationId} and the same Fleet and identity to resume this creation.`,
            )
          }
          pending = created
          if (deps.now() >= deadline) return created
          await deps.sleep(RETRY_DELAY_MS)
        }
        return created
      },
      {
        success: (created) =>
          created.state === 'ready'
            ? `Instance provisioned: ${slug} ${chalk.dim(`(${created.url})`)}`
            : `Instance provisioning continues: ${slug} ${chalk.dim(`(${created.phase ?? 'pending'} · ${created.operationId ?? operationId})`)}`,
      },
    )

  const created = await runProvision()
  if (created.state !== 'ready') {
    console.error(
      chalk.yellow(
        `Instance "${slug}" is retained. Rerun your original instance create command with --operation ${operationId}${createOpts.fleet === undefined ? '' : ` --fleet '${createOpts.fleet}'`} and the same Admin target options and creator identity.`,
      ),
    )
    return { created, slug }
  }
  let access: NonNullable<ProvisionResult['access']>
  try {
    access = await deps.activateInstance(created, opts)
  } catch (cause) {
    access = {
      status: 'pending',
      code: cause instanceof AstraleError ? cause.code : 'OWNER_ACTIVATION_UNAVAILABLE',
    }
    console.error(
      chalk.yellow(
        `⚠ Instance "${slug}" exists, but human access is pending. Rerun your original instance create command with the same Admin target options and the creator's WorkOS identity (--as, not --creds).`,
      ),
    )
  }
  if (access.status === 'completed') {
    try {
      // The catalogue owns the complete transition under its lock, including
      // a target another CLI process selected while creation was running.
      const bookmarked = await deps.bookmarkCreatedInstance({
        slug,
        url: created.url,
        ...(created.organizationId ? { organizationId: created.organizationId } : {}),
        ...(authentication.defaultIdentity
          ? { defaultIdentity: authentication.defaultIdentity }
          : {}),
      })
      bookmark = { status: 'completed', name: bookmarked.name }
    } catch (cause) {
      const failure =
        cause instanceof AstraleError
          ? cause
          : new AstraleError(
              'INSTANCE_BOOKMARK_FAILED',
              `Instance "${slug}" is ready, but its local bookmark could not be saved: ${cause instanceof Error ? cause.message : String(cause)}`,
              `Fix local CLI storage, then rerun your original instance create command with --operation ${operationId}.`,
            )
      bookmark = {
        status: 'pending',
        code: failure.code,
        message: failure.message,
        ...(failure.hint ? { hint: failure.hint } : {}),
      }
      await formatKernelError(failure, machine, undefined, opts.debug)
    }
  }
  let rootIdentity: ImportedInstanceRootIdentity | undefined
  let rootIdentityError: unknown
  // Before access and bookmarking complete, the slug may still name another
  // local Instance's root. A ready receipt replay resumes automatic recovery.
  if (bookmark?.status === 'completed') {
    try {
      rootIdentity = await withSpinner(
        `Importing root identity for ${slug}`,
        !machine,
        () =>
          deps.importInstanceRootIdentity(createOpts, created.id, {
            bookmark: false,
            replace: 'same-issuer',
          }),
        { success: (result) => `Root identity imported: ${result.name}` },
      )
    } catch (error) {
      rootIdentityError = error
    }
  }

  // Warnings go to stderr so machine-readable stdout stays clean.
  const warn = (msg: string) => console.error(chalk.yellow('⚠'), msg)
  if (rootIdentityError !== undefined) {
    if (rootIdentityError instanceof AstraleError) {
      await formatKernelError(rootIdentityError, machine, undefined, opts.debug)
    } else {
      const message =
        rootIdentityError instanceof Error ? rootIdentityError.message : String(rootIdentityError)
      warn(`Could not import the Instance root identity: ${message}`)
      warn(`Recover it later with: astrale instance root import ${slug}`)
    }
  }
  if (!machine && access.status === 'completed' && bookmark?.status === 'completed') {
    console.log(`Instance ready: ${slug} ${chalk.dim(`(${created.url})`)}`)
  }

  return {
    created,
    slug,
    access,
    ...(bookmark === undefined ? {} : { bookmark }),
    ...(rootIdentity === undefined ? {} : { rootIdentity }),
    ...(rootIdentityError === undefined ? {} : { rootIdentityError }),
  }
}

/** Admit the exact operation-id grammar exposed by Admin Instance creation. */
function acceptInstanceCreateOperationId(input: unknown): string {
  if (typeof input !== 'string' || !INSTANCE_CREATE_OPERATION_ID.test(input)) {
    throw new AstraleError(
      'INVALID_INPUT',
      'Instance create operation id must contain 1-256 Admin-compatible ASCII characters.',
    )
  }
  return input
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
