import chalk from 'chalk'

import type { KernelCommandOpts } from '../../kernel'
import type { CommandDefinition } from '../../program/index'

import { AstraleError } from '../../errors'
import { listOwnedInstances } from '../../kernel/client'
import { findOwnedInstance } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { fatal, log, withSpinner } from '../../lib/log'
import { isMachine, output, type RawOutputOpts } from '../../lib/output'

type StatusOpts = KernelCommandOpts & AdminTargetCommandOpts & RawOutputOpts

export default {
  name: 'status',
  description: 'Show admin instance status',
  arguments: [{ name: 'id', description: 'Instance slug', required: true }],
  options: [...ADMIN_TARGET_OPTIONS],
  action: async (id: string, opts: StatusOpts) => {
    try {
      const result = await withSpinner(`Fetching instance ${id}`, !isMachine(opts), () =>
        listOwnedInstances(opts).then((instances) => {
          const match = findOwnedInstance(instances, id)
          if (match) return match
          throw new AstraleError(
            'INSTANCE_NOT_FOUND',
            `No owned instance matches "${id}".`,
            'Run `astrale instance list` to see your instances.',
          )
        }),
      )
      if (isMachine(opts)) {
        output(result, opts)
        return
      }
      console.log(`${chalk.bold(result.slug)} ${chalk.dim(result.url)}`)
      log.dim(`  state: ${result.state}${result.phase ? ` (${result.phase})` : ''}`)
      if (result.error) log.dim(`  error: ${result.error}`)
      if (result.region) log.dim(`  region: ${result.region}`)
      if (result.hostId) log.dim(`  host: ${result.hostId}`)
      if (result.organizationId) log.dim(`  organization: ${result.organizationId}`)
      if (result.createdAt) log.dim(`  created: ${result.createdAt}`)
    } catch (e) {
      fatal(e, opts)
    }
  },
} satisfies CommandDefinition
