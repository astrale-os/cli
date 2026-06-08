import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { AuthError } from '../../errors'
import { withAdminKernelClient } from '../../kernel/client'
import { ADMIN_INSTANCE } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { readIdentities, type IdentityStore } from '../../lib/identity'
import { addInstance, setActive } from '../../lib/instance'
import { fatal, log } from '../../lib/log'
import { isRawOutput, output } from '../../lib/output'
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
  caller's single eligible host. The new instance is bookmarked and selected by
  default.

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
    { flags: '--no-use', description: 'Do not bookmark and select the new instance' },
  ],
  action: async (id: string, opts: CreateOpts) => {
    try {
      validateSlug(id)
      await assertAlphaCreateAuth(opts)
      const result = await withAdminKernelClient(
        opts,
        async (ctx) =>
          (await ctx.client.call(`${ADMIN_INSTANCE}/alphaCreate`, {
            slug: id,
            ...(opts.hostId ? { host_id: opts.hostId } : {}),
          })) as { url: string },
      )

      const use = opts.use !== false
      if (use) {
        const kernelUrl = `${result.url.replace(/\/+$/, '')}/api`
        await addInstance(id, {
          url: kernelUrl,
          name: id,
          kind: 'bookmark',
          mode: 'remote',
          issuer: kernelUrl,
        })
        await setActive(id)
      }

      if (isRawOutput(opts)) {
        output(result, opts)
        return
      }
      log.success(`Instance provisioned: ${id}`)
      log.dim(`  url: ${result.url}`)
      if (use) log.dim(`  bookmarked + active: ${result.url}/api`)
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
