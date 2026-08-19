import chalk from 'chalk'

import type { CommandDefinition } from '../../program/index'

import { getDefault } from '../../identity/index'
import { resolveAdminTargetFromStore } from '../../lib/admin-target'
import { readConfig } from '../../lib/config'
import { readInstances } from '../../lib/instance'
import { fatal, log } from '../../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../../lib/output'

type AdminStatus = {
  target: ReturnType<typeof resolveAdminTargetFromStore>
  identity: {
    name: string
    registered: boolean
  } | null
}

export default {
  name: 'status',
  description: 'Show configured admin kernel target',
  options: [...RAW_OUTPUT_OPTIONS],
  action: async (opts: RawOutputOpts) => {
    try {
      const [config, instances, identity] = await Promise.all([
        readConfig(),
        readInstances(),
        getDefault().catch(() => null),
      ])
      const target = resolveAdminTargetFromStore({}, config, instances)
      const status: AdminStatus = {
        target,
        identity: identity
          ? {
              name: identity.name,
              registered: !!identity.registrations?.[target.registrationSlug],
            }
          : null,
      }

      if (isMachine(opts)) {
        output(status, opts)
        return
      }

      console.log(chalk.bold('Admin'))
      console.log(`  ${chalk.bold(target.name)} ${chalk.dim(target.url)}`)
      console.log(`  kernel issuer: ${chalk.dim(target.kernelIssuer)}`)
      console.log(`  source: ${target.source}`)
      if (status.identity) {
        const mark = status.identity.registered ? chalk.green('yes') : chalk.yellow('no')
        console.log(`  identity ${status.identity.name} registered: ${mark}`)
      } else {
        log.dim('  No default identity. Run: astrale identity create <name>')
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
