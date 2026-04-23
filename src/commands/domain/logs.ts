import type { CommandDefinition } from '../../command'

import { fatalNotImplemented } from '../../lib/log'

export default {
  name: 'logs',
  description: 'Stream domain worker logs (stub — use adapter-specific tooling, §9)',
  options: [{ flags: '--follow', description: 'Follow logs' }],
  action: async () =>
    fatalNotImplemented(
      'astrale domain logs',
      "Use the DomainPlatform adapter's own logs viewer (e.g. Cloudflare dashboard, §11).",
    ),
} satisfies CommandDefinition
