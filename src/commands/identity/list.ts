import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { readIdentities } from '../../lib/identity'
import { log } from '../../lib/log'
import { isRawOutput, output, RAW_OUTPUT_OPTIONS } from '../../lib/output'

export default {
  name: 'list',
  description: 'List all identities',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: { raw?: boolean; json?: boolean }) => {
    const isRaw = isRawOutput(opts)
    const store = await readIdentities()

    if (isRaw) {
      const items = Object.entries(store.identities).map(([name, id]) => ({
        name,
        subject: id.subject,
        default: name === store.default,
        createdAt: id.createdAt,
      }))
      output({ default: store.default, identities: items }, opts)
      return
    }

    const names = Object.keys(store.identities)
    if (names.length === 0) {
      log.dim('  No identities. Run: astrale identity create <name>')
      return
    }

    for (const name of names) {
      const identity = store.identities[name]
      const isDefault = name === store.default
      const marker = isDefault ? chalk.green(' *') : ''
      const subject = identity.subject !== name ? chalk.dim(` (subject: ${identity.subject})`) : ''
      console.log(`  ${chalk.bold(name)}${subject}${marker}`)
    }
  },
} satisfies CommandDefinition
