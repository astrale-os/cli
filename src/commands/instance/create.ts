import chalk from 'chalk'

import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { AuthError } from '../../errors'
import { withAdminKernelClient } from '../../kernel/client'
import { ADMIN_INSTANCE } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { readIdentities, type IdentityStore } from '../../lib/identity'
import { setActive, upsertManagedBookmark } from '../../lib/instance'
import { fatal, withSpinner } from '../../lib/log'
import { isMachine, output } from '../../lib/output'
import { promptSelect, promptText } from '../../lib/prompt'
import { validateSlug } from '../../lib/validation'

type CreateOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    hostId?: string
    // Global flags (program.ts) that force non-interactive — mirrors `instance use`.
    ci?: boolean
    noPrompt?: boolean
  }

/** inquirer `validate` for a slug: true when valid, else the human message. */
function slugError(value: string): true | string {
  try {
    validateSlug(value)
    return true
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid slug'
  }
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

export default {
  name: 'create',
  description: 'Provision an alpha instance through the admin kernel (Instance.alphaCreate)',
  afterHelpText: `
Behavior:
  Calls Instance.alphaCreate on the configured admin kernel. The caller must be
  logged in with WorkOS. When --host-id is omitted, the admin kernel chooses the
  caller's single eligible host. The new instance becomes the active instance.

  Run with no slug in a terminal and it prompts for one (validated live). With
  no TTY — or --ci / --no-prompt — the slug argument is required up front, so
  piped / CI / agent runs fail fast instead of waiting on input.

Examples:
  $ astrale auth login
  $ astrale instance create demo
`,
  arguments: [{ name: 'id', description: 'Instance slug', required: false }],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    {
      flags: '--host-id <id>',
      description: 'Advanced: host node id to provision on when multiple hosts are available',
    },
  ],
  action: async (id: string | undefined, opts: CreateOpts) => {
    try {
      // Interactive (TTY only): prompt for the slug when omitted, with live
      // validation. No TTY / --ci / --no-prompt / CI → the slug arg is required
      // (fail fast, never hang a piped / agent / LLM run).
      const interactive = !!process.stdin.isTTY && !(opts.ci || opts.noPrompt || process.env.CI)
      if (!id && interactive) id = await promptText('Instance slug', { validate: slugError })
      if (!id) {
        throw new Error('`instance create` needs a slug, e.g. `astrale instance create demo`.')
      }
      // Snapshot to a const: `id` is a (mutable) param, so TS widens it back to
      // `string | undefined` inside the withSpinner closure below — `slug` stays
      // narrowed to string everywhere it's used.
      const slug = id
      validateSlug(slug)
      await assertAlphaCreateAuth(opts)
      // The created instance must belong to the LOGGED-IN identity — never to
      // an identity pinned on the admin bookmark (that mismatch silently made
      // a fresh user's instance unusable). `--as` still wins.
      if (!opts.as) opts = { ...opts, as: (await readIdentities()).default }
      let repointedFrom: string | undefined
      let selectionError: unknown = null
      // Provisioning a child instance runs a multi-step saga (1-3 min). The
      // global 30s default doesn't just fail the CLIENT: the disconnect kills
      // the worker's request mid-saga and leaves TORN state (slug taken,
      // routing live, no instance node — unrecoverable by retry). Default to
      // a saga-sized timeout; an explicit --timeout still wins.
      const createOpts = { ...opts, timeout: opts.timeout ?? '240000' }
      const runProvision = (hostId: string | undefined) =>
        withSpinner(
          `Provisioning instance ${slug}`,
          !isMachine(opts),
          async () => {
            const created = await withAdminKernelClient(
              createOpts,
              async (ctx) =>
                (await ctx.client.call(`${ADMIN_INSTANCE}/alphaCreate`, {
                  slug,
                  ...(hostId ? { host_id: hostId } : {}),
                })) as { url: string; organizationId?: string },
            )
            try {
              // Org id from the create response — authoritative for token
              // scoping (the router's /auth/org is eventually consistent).
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
      // capacity / a non-interactive run all reject through to `fatal` below,
      // surfacing the server's own message (e.g. "ask an admin to grant USE on a
      // host") plus the listed ids. An explicit `--host-id` skips all of this.
      const result = await runProvision(opts.hostId).catch(async (e: unknown) => {
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
        warn(`Bookmark "${slug}" repointed: ${repointedFrom} → ${result.url}`)
      }

      if (isMachine(opts)) {
        output(result, opts)
        return
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition

async function assertAlphaCreateAuth(opts: Pick<CreateOpts, 'as' | 'creds'>): Promise<void> {
  if (opts.creds) return
  assertAlphaCreateIdentity(await readIdentities(), opts)
}

export function assertAlphaCreateIdentity(
  store: IdentityStore,
  opts: Pick<CreateOpts, 'as'> = {},
): void {
  const name = opts.as ?? store.default
  const identity = store.identities[name]
  if (identity && identity.source === 'idp') return
  throw new AuthError(
    'WorkOS login required for `astrale instance create`',
    'Run: astrale auth login',
  )
}
