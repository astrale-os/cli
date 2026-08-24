import chalk from 'chalk'

import type { KernelCommandOpts } from '../../connection'
import type { CommandDefinition } from '../../program/index'

import { formatKernelError } from '../../connection/errors'
import { statusOwnedInstance } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { log, withSpinner } from '../../lib/log'
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
        statusOwnedInstance(opts, id),
      )
      if (isMachine(opts)) {
        output(result, opts)
        return
      }
      console.log(`${chalk.bold(result.slug)} ${chalk.dim(result.url)}`)
      log.dim(`  state: ${result.state}${result.phase ? ` (${result.phase})` : ''}`)
      if (result.error) log.dim(`  error: ${result.error}`)
      if (result.organizationId) log.dim(`  organization: ${result.organizationId}`)
      if (result.createdAt) log.dim(`  created: ${result.createdAt}`)
    } catch (e) {
      await formatKernelError(e, isMachine(opts), undefined, opts.debug)
      process.exit(1)
    }
  },
} satisfies CommandDefinition
