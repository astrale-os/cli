import chalk from 'chalk'

import type { KernelCommandOpts } from '../connection'
import type { AdminTargetCommandOpts } from './admin-target'

import { AuthError } from '../errors'
import { readIdentities, type IdentityStore } from '../identity/index'
import { createOwnedInstance } from './admin-instance'
import { setActive, upsertManagedBookmark } from './instance'
import { withSpinner } from './log'
import { isMachine } from './output'
import { validateSlug } from './validation'

export type ProvisionOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    // Global flags (program.ts) that force non-interactive — mirrors `instance use`.
    ci?: boolean
    noPrompt?: boolean
  }

/** The created instance plus the local-bookmark side effects of provisioning. */
export type ProvisionResult = {
  /** The raw admin-kernel response — the stable machine surface for `--json`. */
  created: { url: string; organizationId?: string }
  slug: string
  /** Set when an existing bookmark of the same name was repointed to a new kernel. */
  repointedFrom?: string
  /** Set when bookmarking/activating the new instance failed (non-fatal). */
  selectionError?: unknown
}

/** Provisioning a child instance runs a multi-step saga (1-3 min). */
const SAGA_TIMEOUT_MS = '240000'

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
): Promise<ProvisionResult> {
  validateSlug(slug)
  const authentication = await instanceCreateAuthentication(opts)
  opts = authentication.opts

  const machine = isMachine(opts)
  let repointedFrom: string | undefined
  let selectionError: unknown = null
  // The global 30s default doesn't just fail the CLIENT: the disconnect kills
  // the worker's request mid-saga and leaves TORN state (slug taken, routing
  // live, no instance node — unrecoverable by retry). Default to a saga-sized
  // timeout; an explicit --timeout still wins.
  const createOpts = { ...opts, timeout: opts.timeout ?? SAGA_TIMEOUT_MS }

  const runProvision = () =>
    withSpinner(
      `Provisioning instance ${slug}`,
      !machine,
      async () => {
        const created = await createOwnedInstance(createOpts, slug)
        try {
          // Org id from the create response — authoritative for token scoping
          // (the router's /auth/org is eventually consistent).
          const bookmarked = await upsertManagedBookmark({
            key: slug,
            slug,
            url: created.url,
            ...(created.organizationId ? { organizationId: created.organizationId } : {}),
            ...(authentication.defaultIdentity
              ? { defaultIdentity: authentication.defaultIdentity }
              : {}),
          })
          repointedFrom = bookmarked.repointedFrom
          await setActive(slug)
        } catch (e) {
          selectionError = e
        }
        return created
      },
      {
        success: (created) =>
          `Instance provisioned: ${slug} ${chalk.dim(`(${created.url})${selectionError ? '' : ' · active'}`)}`,
      },
    )

  const created = await runProvision()

  // Warnings go to stderr so machine-readable stdout stays clean.
  const warn = (msg: string) => console.error(chalk.yellow('⚠'), msg)
  if (selectionError) {
    const message =
      selectionError instanceof Error ? selectionError.message : String(selectionError)
    warn(`Could not select the new instance: ${message}`)
  } else if (repointedFrom) {
    warn(`Bookmark "${slug}" repointed: ${repointedFrom} → ${created.url}`)
  }

  return { created, slug, repointedFrom, ...(selectionError ? { selectionError } : {}) }
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
