import type { CommandDefinition } from '../../command'

import { fatalNotImplemented } from '../../lib/log'

export default {
  name: 'logs',
  description: 'Stream domain worker logs (stub — use adapter-specific tooling)',
  afterHelpText: `
Behavior:
  Stub (NotImplemented in v1) — use your worker platform's own log
  tooling (e.g. \`wrangler tail\`) until this lands.
`,
  options: [{ flags: '--follow', description: 'Follow logs' }],
  action: async () =>
    fatalNotImplemented(
      'astrale domain logs',
      "Use the DomainPlatform adapter's own logs viewer (e.g. Cloudflare dashboard).",
    ),
} satisfies CommandDefinition
