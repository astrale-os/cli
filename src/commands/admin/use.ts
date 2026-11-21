import type { CommandDefinition } from '../../program/index'

import { AstraleError } from '../../errors'
import {
  AdminTargetConfigSchema,
  DEFAULT_ADMIN_DOMAIN_ISSUER,
  DEFAULT_ADMIN_TARGET_NAME,
} from '../../lib/admin/target'
import { readConfig, writeConfig } from '../../lib/config'
import { resolveInstance } from '../../lib/instance/bookmarks'
import { log } from '../../lib/terminal/log'
import { validateUrl } from '../../lib/validation'

type AdminUseOpts = {
  url?: string
  name?: string
  kernelIssuer?: string
  domainIssuer?: string
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
  $ astrale admin use --url https://admin.eu.astrale.ai/api --domain-issuer https://admin.astrale.ai
  $ astrale admin status
`,
  arguments: [{ name: 'bookmark', description: 'Bookmarked admin instance', required: false }],
  options: [
    { flags: '--url <url>', description: 'Direct admin kernel URL' },
    {
      flags: '--name <name>',
      description: 'Friendly name / registration slug for direct URL admin target',
    },
    {
      flags: '--kernel-issuer <url>',
      description: 'Admin Kernel issuer/audience if different from URL',
    },
    {
      flags: '--domain-issuer <url>',
      description: 'Exact native Admin Domain issuer used for token exchange',
    },
  ],
  action: async (bookmark: string | undefined, opts: AdminUseOpts) => {
    if (bookmark && opts.url) {
      throw new AstraleError(
        'INVALID_FLAG',
        'Choose either a bookmark argument or --url, not both.',
      )
    }

    const config = await readConfig()
    if (opts.url) {
      if (opts.domainIssuer === undefined) {
        throw new AstraleError(
          'MISSING_ARG',
          'Direct Admin targets require --domain-issuer <url> for token exchange.',
        )
      }
      for (const url of [opts.url, opts.kernelIssuer, opts.domainIssuer]) {
        if (url !== undefined) validateUrl(url)
      }
      const name = opts.name ?? DEFAULT_ADMIN_TARGET_NAME
      await writeConfig({
        ...config,
        admin: AdminTargetConfigSchema.parse({
          name,
          url: opts.url,
          kernelIssuer: opts.kernelIssuer ?? opts.url,
          domainIssuer: opts.domainIssuer,
        }),
      })
      log.success(`Admin target: ${name} (${opts.url})`)
      return
    }

    if (!bookmark) {
      throw new AstraleError(
        'MISSING_ARG',
        'Missing admin target.',
        'Use: astrale admin use <bookmark> or astrale admin use --url <url>',
      )
    }

    const resolved = await resolveInstance(bookmark)
    if (resolved.domainIssuer === undefined) {
      throw new AstraleError(
        'ADMIN_DOMAIN_ISSUER_MISSING',
        `Admin bookmark "${resolved.name}" has no Domain issuer.`,
        'Re-bookmark it with --domain-issuer <url>.',
      )
    }
    await writeConfig({
      ...config,
      admin: AdminTargetConfigSchema.parse({
        instance: resolved.name,
        domainIssuer: opts.domainIssuer ?? config.admin.domainIssuer ?? DEFAULT_ADMIN_DOMAIN_ISSUER,
      }),
    })
    log.success(`Admin target: ${resolved.name} (${resolved.url})`)
  },
} satisfies CommandDefinition
