import type { CommandDefinition } from '../../command'

import { fatalNotImplemented } from '../../lib/log'

export default {
  name: 'build',
  description: 'Build a domain package (stub — use `pnpm build:spec` in the domain repo, §9)',
  options: [{ flags: '--preset <p>', description: 'Build preset name' }],
  action: async (opts: { preset?: string }) =>
    fatalNotImplemented(
      'astrale domain build',
      `Run the domain's local script (e.g. \`pnpm build:spec${opts.preset ? ` --preset ${opts.preset}` : ''}\` inside kernel/domains/<name>).`,
    ),
} satisfies CommandDefinition
