import type { CommandDefinition } from '../../command'

import { fatalNotImplemented } from '../../lib/log'

export default {
  name: 'login',
  description: 'Authenticate to astrale cloud (import remote identities, §2.2)',
  action: async () =>
    fatalNotImplemented(
      'astrale auth login',
      'Astrale cloud adapter is stubbed in v1 (§15) — local path only for now.',
    ),
} satisfies CommandDefinition
