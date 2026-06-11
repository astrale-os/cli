import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { AuthError } from '../../errors'
import { withAdminKernelClient } from '../../kernel/client'
import { ADMIN_INSTANCE } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { readIdentities, type IdentityStore } from '../../lib/identity'
import { setActiveName, upsertInstance } from '../../lib/instance'
import { fatal, log, withSpinner } from '../../lib/log'
import { isMachine, output } from '../../lib/output'
import { validateSlug } from '../../lib/validation'

type CreateOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    hostId?: string
    use?: boolean
  }

export default {
  name: 'create',
  description: 'Provision an alpha instance through the admin kernel (Instance.alphaCreate)',
  afterHelpText: `
Behavior:
  Calls Instance.alphaCreate on the configured admin kernel. The caller must be
  logged in with WorkOS. When --host-id is omitted, the admin kernel chooses the
  caller's single eligible host. The new managed instance is selected by
  default without creating a local bookmark.

Examples:
  $ astrale auth login
  $ astrale instance create demo
  $ astrale instance create demo --no-use
`,
  arguments: [{ name: 'id', description: 'Instance slug', required: true }],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    {
      flags: '--host-id <id>',
      description: 'Advanced: host node id to provision on when multiple hosts are available',
    },
    { flags: '--no-use', description: 'Do not select the new instance after provisioning' },
  ],
  action: async (id: string, opts: CreateOpts) => {
    try {
      validateSlug(id)
      await assertAlphaCreateAuth(opts)
      // Provisioning a child instance runs a multi-step saga (1-3 min). The
      // global 30s default doesn't just fail the CLIENT: the disconnect kills
      // the worker's request mid-saga and leaves TORN state (slug taken,
      // routing live, no instance node — unrecoverable by retry). Default to
      // a saga-sized timeout; an explicit --timeout still wins.
      const createOpts = { ...opts, timeout: opts.timeout ?? '240000' }
      const result = await withSpinner(`Provisioning instance ${id}`, !isMachine(opts), () =>
        withAdminKernelClient(
          createOpts,
          async (ctx) =>
            (await ctx.client.call(`${ADMIN_INSTANCE}/alphaCreate`, {
              slug: id,
              ...(opts.hostId ? { host_id: opts.hostId } : {}),
            })) as { url: string },
        ),
      )

      const use = opts.use !== false
      if (use) {
        // Persist a real bookmark entry (url is known) BEFORE pointing the
        // active selector at it — a name-only active pointer resolved through
        // the admin on every call and broke silently when that lookup failed.
        await upsertInstance(id, { url: result.url })
        await setActiveName(id)
      }

      if (isMachine(opts)) {
        output(result, opts)
        return
      }
      log.success(`Instance provisioned: ${id}`)
      log.dim(`  url: ${result.url}`)
      if (use) log.dim(`  active managed instance: ${id}`)
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
