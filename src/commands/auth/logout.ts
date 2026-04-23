import type { CommandDefinition } from '../../command'

import { fatalNotImplemented } from '../../lib/log'

export default {
  name: 'logout',
  description: 'Logout from astrale cloud',
  action: async () =>
    fatalNotImplemented('astrale auth logout', 'Astrale cloud adapter is stubbed in v1 (§15).'),
} satisfies CommandDefinition
