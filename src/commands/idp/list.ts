import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { listIdpConfigs } from '../../lib/idp'
import { log } from '../../lib/log'
import { isRawOutput, output, RAW_OUTPUT_OPTIONS } from '../../lib/output'

export default {
  name: 'list',
  description: 'List configured identity providers',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: { raw?: boolean; json?: boolean }) => {
    const entries = (await listIdpConfigs()).map((config) => ({
      name: config.name,
      issuer: config.entry.issuer,
      clientId: config.client.client_id,
      scope: config.client.scope,
      builtIn: !!config.entry.builtIn,
      updatedAt: config.entry.updatedAt,
    }))

    if (isRawOutput(opts)) {
      output({ idps: entries }, opts)
      return
    }

    if (entries.length === 0) {
      log.dim('  No IdPs. Run: astrale idp add <name> --issuer <url>')
      return
    }

    for (const idp of entries) {
      const builtIn = idp.builtIn ? chalk.dim(' (built-in)') : ''
      const client = idp.clientId ? chalk.dim(` client_id=${idp.clientId}`) : ''
      console.log(`  ${chalk.bold(idp.name)}${builtIn} ${chalk.dim(idp.issuer)}${client}`)
    }
  },
} satisfies CommandDefinition
