import type { CommandDefinition } from '../../command'

import { fatalNotImplemented } from '../../lib/log'

export default {
  name: 'deploy',
  description: "Deploy a domain worker (stub — use the domain's deploy script, §9)",
  options: [
    { flags: '--staged', description: 'Deploy as staged preview' },
    { flags: '--promote', description: 'Promote a staged deployment to production' },
  ],
  action: async () =>
    fatalNotImplemented(
      'astrale domain deploy',
      "Use the domain's DomainPlatform adapter deploy pipeline (§11) — kernel/domains/<name>.",
    ),
} satisfies CommandDefinition
