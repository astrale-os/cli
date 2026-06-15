import type { CommandDefinition } from '../../command'

import { AdminTargetConfigSchema, DEFAULT_ADMIN_TARGET_NAME } from '../../lib/admin-target'
import { readConfig, writeConfig } from '../../lib/config'
import { resolveInstance } from '../../lib/instance'
import { fatal, log } from '../../lib/log'

type AdminUseOpts = {
  url?: string
  name?: string
  issuer?: string
}

export default {
  name: 'use',
  description: 'Set the admin kernel target',
  afterHelpText: `
Behavior:
  The admin target is the admin kernel used by admin-backed commands such as
  \`astrale instance create\`, \`astrale instance list\`, and
  \`astrale instance delete\`. It is independent from the active instance used
  by normal kernel calls.

Examples:
  $ astrale admin use admin
  $ astrale admin use --url https://admin.eu.astrale.ai/api
  $ astrale admin status
`,
  arguments: [{ name: 'bookmark', description: 'Bookmarked admin instance', required: false }],
  options: [
    { flags: '--url <url>', description: 'Direct admin kernel URL' },
    {
      flags: '--name <name>',
      description: 'Friendly name / registration slug for direct URL admin target',
    },
    { flags: '--issuer <url>', description: 'Admin kernel issuer/audience if different from URL' },
  ],
  action: async (bookmark: string | undefined, opts: AdminUseOpts) => {
    try {
      if (bookmark && opts.url) {
        fatal('Choose either a bookmark argument or --url, not both')
      }

      const config = await readConfig()
      if (opts.url) {
        const name = opts.name ?? DEFAULT_ADMIN_TARGET_NAME
        await writeConfig({
          ...config,
          admin: AdminTargetConfigSchema.parse({
            name,
            url: opts.url,
            issuer: opts.issuer ?? opts.url,
          }),
        })
        log.success(`Admin target: ${name} (${opts.url})`)
        return
      }

      if (!bookmark) {
        fatal(
          'Missing admin target. Use: astrale admin use <bookmark> or astrale admin use --url <url>',
        )
      }

      const resolved = await resolveInstance(bookmark)
      await writeConfig({
        ...config,
        admin: AdminTargetConfigSchema.parse({
          instance: resolved.name,
        }),
      })
      log.success(`Admin target: ${resolved.name} (${resolved.url})`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
