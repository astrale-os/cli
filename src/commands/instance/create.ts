import chalk from 'chalk'

import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { AuthError } from '../../errors'
import { withAdminKernelClient } from '../../kernel/client'
import { ADMIN_INSTANCE } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { readIdentities, type IdentityStore } from '../../lib/identity'
import { readInstances, setActive, upsertManagedBookmark } from '../../lib/instance'
import { fatal, withSpinner } from '../../lib/log'
import { isMachine, output } from '../../lib/output'
import { validateSlug } from '../../lib/validation'

type CreateOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    hostId?: string
  }

export default {
  name: 'create',
  description: 'Provision an alpha instance through the admin kernel (Instance.alphaCreate)',
  afterHelpText: `
Behavior:
  Calls Instance.alphaCreate on the configured admin kernel. The caller must be
  logged in with WorkOS. When --host-id is omitted, the admin kernel chooses the
  caller's single eligible host. The new instance becomes the active instance.

Examples:
  $ astrale auth login
  $ astrale instance create demo
`,
  arguments: [{ name: 'id', description: 'Instance slug', required: true }],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    {
      flags: '--host-id <id>',
      description: 'Advanced: host node id to provision on when multiple hosts are available',
    },
  ],
  action: async (id: string, opts: CreateOpts) => {
    try {
      validateSlug(id)
      await assertAlphaCreateAuth(opts)
      await warnOnPinnedAdminIdentity(opts)
      let repointedFrom: string | undefined
      let selectionError: unknown = null
      // Provisioning a child instance runs a multi-step saga (1-3 min). The
      // global 30s default doesn't just fail the CLIENT: the disconnect kills
      // the worker's request mid-saga and leaves TORN state (slug taken,
      // routing live, no instance node — unrecoverable by retry). Default to
      // a saga-sized timeout; an explicit --timeout still wins.
      const createOpts = { ...opts, timeout: opts.timeout ?? '240000' }
      const result = await withSpinner(
        `Provisioning instance ${id}`,
        !isMachine(opts),
        async () => {
          const created = await withAdminKernelClient(
            createOpts,
            async (ctx) =>
              (await ctx.client.call(`${ADMIN_INSTANCE}/alphaCreate`, {
                slug: id,
                ...(opts.hostId ? { host_id: opts.hostId } : {}),
              })) as { url: string; organizationId?: string },
          )
          try {
            // Persist the org id from the create response: it makes token
            // scoping for this instance immune to the router's eventually-
            // consistent `/auth/org` (stale for ~90s after create — fatal on
            // a reused slug, where it serves the PREVIOUS instance's org).
            const bookmarked = await upsertManagedBookmark(
              id,
              id,
              created.url,
              created.organizationId,
            )
            repointedFrom = bookmarked.repointedFrom
            await setActive(id)
          } catch (e) {
            selectionError = e
          }
          return created
        },
        {
          success: (created) =>
            `Instance provisioned: ${id} ${chalk.dim(`(${created.url})${selectionError ? '' : ' · active'}`)}`,
        },
      )

      // Warnings go to stderr so machine-readable stdout stays clean.
      const warn = (msg: string) => console.error(chalk.yellow('⚠'), msg)
      if (selectionError) {
        const message =
          selectionError instanceof Error ? selectionError.message : String(selectionError)
        warn(`Could not select the new instance: ${message}`)
      } else if (repointedFrom) {
        warn(`Bookmark "${id}" repointed: ${repointedFrom} → ${result.url}`)
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

/**
 * The admin bookmark may pin its own `defaultIdentity`, which silently
 * overrides the logged-in identity for every admin-target call — the created
 * instance then BELONGS to the pinned identity, not the caller (observed live
 * 2026-06-11: a fresh user's instance was owned by the operator's pinned
 * identity; the user could never sign into it). Warn loudly; `--as` wins.
 */
async function warnOnPinnedAdminIdentity(opts: Pick<CreateOpts, 'as'>): Promise<void> {
  if (opts.as) return
  try {
    const [identities, instances] = await Promise.all([readIdentities(), readInstances()])
    const pinned = instances.instances['admin']?.defaultIdentity
    if (pinned && identities.default && pinned !== identities.default) {
      console.error(
        chalk.yellow('⚠'),
        `The "admin" bookmark pins identity "${pinned}" — this instance will belong to it, ` +
          `NOT to your active identity "${identities.default}". Pass --as ${identities.default} to own it.`,
      )
    }
  } catch {
    // best-effort advisory — never block create on it
  }
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
