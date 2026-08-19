import chalk from 'chalk'

import type { KernelCommandOpts } from '../connection'
import type { AdminTargetCommandOpts } from './admin-target'

import { AuthError } from '../errors'
import { readIdentities, type IdentityStore } from '../identity/index'
import { createOwnedInstance } from './admin-instance'
import { setActive, upsertManagedBookmark } from './instance'
import { withSpinner } from './log'
import { isMachine } from './output'
import { promptSelect } from './prompt'
import { validateSlug } from './validation'

export type ProvisionOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    hostId?: string
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
 * Provision an alpha instance through the admin kernel, then bookmark it and
 * make it the active target. Extracted from `instance create` so `astrale
 * setup` provisions through the exact same saga (auth assertion → alphaCreate →
 * bookmark → set-active), including the interactive multi-host picker.
 *
 * Presentation is deliberately minimal here (a spinner + a one-line success);
 * the caller renders anything richer — `setup` follows this with a hero panel.
 */
export async function provisionInstance(
  slug: string,
  opts: ProvisionOpts,
): Promise<ProvisionResult> {
  validateSlug(slug)
  await assertAlphaCreateAuth(opts)
  // The created instance must belong to the LOGGED-IN identity — never to an
  // identity pinned on the admin bookmark (that mismatch silently made a fresh
  // user's instance unusable). `--as` still wins.
  if (!opts.as) opts = { ...opts, as: (await readIdentities()).default }

  const machine = isMachine(opts)
  const interactive = !!process.stdin.isTTY && !(opts.ci || opts.noPrompt || process.env.CI)

  let repointedFrom: string | undefined
  let selectionError: unknown = null
  // The global 30s default doesn't just fail the CLIENT: the disconnect kills
  // the worker's request mid-saga and leaves TORN state (slug taken, routing
  // live, no instance node — unrecoverable by retry). Default to a saga-sized
  // timeout; an explicit --timeout still wins.
  const createOpts = { ...opts, timeout: opts.timeout ?? SAGA_TIMEOUT_MS }

  const runProvision = (hostId: string | undefined) =>
    withSpinner(
      `Provisioning instance ${slug}`,
      !machine,
      async () => {
        const created = await createOwnedInstance(createOpts, slug, hostId)
        try {
          // Org id from the create response — authoritative for token scoping
          // (the router's /auth/org is eventually consistent).
          const bookmarked = await upsertManagedBookmark(
            slug,
            slug,
            created.url,
            created.organizationId,
          )
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

  // Host placement is chosen SERVER-side (the caller's ready + USE-granted
  // hosts). We recover ONLY from its multi-host ambiguity: pop a picker and
  // retry with the chosen host_id — the ambiguity error throws before any
  // provisioning side effect, so the retry is clean. No host / permission /
  // capacity / a non-interactive run all reject through to the caller's `fatal`,
  // surfacing the server's own message plus the listed ids. An explicit
  // `--host-id` skips all of this.
  const created = await runProvision(opts.hostId).catch(async (e: unknown) => {
    const hostIds = !opts.hostId && interactive ? parseEligibleHostIds(e) : null
    if (!hostIds) throw e
    const chosen = await promptSelect(
      `${hostIds.length} hosts available — pick one to provision on`,
      hostIds.map((hid) => ({ name: hid, value: hid })),
    )
    if (!chosen) throw e
    return runProvision(chosen)
  })

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

/**
 * Recover the eligible host ids from alphaCreate's multi-host error
 * ("N ready hosts are assigned (id1, id2). Specify host_id…") — only when
 * there's a real choice (>1). Returns null for any other error (no host,
 * permission, capacity). Deliberately coupled to that message wording (Option
 * B: no admin-side change); if it ever drifts we simply stop offering the
 * picker and the raw error is shown instead — no worse than before.
 */
export function parseEligibleHostIds(error: unknown): string[] | null {
  const text = error instanceof Error ? error.message : String(error)
  const match = /ready hosts are assigned \(([^)]+)\)/.exec(text)
  if (!match) return null
  const ids = match[1]!
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return ids.length > 1 ? ids : null
}

async function assertAlphaCreateAuth(opts: Pick<ProvisionOpts, 'as' | 'creds'>): Promise<void> {
  if (opts.creds) return
  assertAlphaCreateIdentity(await readIdentities(), opts)
}

export function assertAlphaCreateIdentity(
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
