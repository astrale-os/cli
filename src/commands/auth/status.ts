import type { CommandDefinition } from '../../command'

import { log } from '../../lib/log'

export default {
  name: 'status',
  description: 'Show the active astrale cloud identity (stub)',
  action: async () => {
    log.info('astrale cloud: not logged in (cloud adapter stubbed in v1)')
    log.dim('  `astrale auth login` will import remote identities once wired.')
  },
} satisfies CommandDefinition
