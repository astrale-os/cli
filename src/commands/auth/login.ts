import type { CommandDefinition } from '../../command'

import { fatalNotImplemented } from '../../lib/log'

export default {
  name: 'login',
  description: 'Authenticate to astrale cloud (import remote identities, §2.2)',
  afterHelpText: `
Behavior:
  Stub in v1 — the astrale cloud adapter is pending. The surface is
  defined; the flow is not yet operational.
`,
  action: async () =>
    fatalNotImplemented(
      'astrale auth login',
      'Astrale cloud adapter is stubbed in v1 (§15) — local path only for now.',
    ),
} satisfies CommandDefinition
