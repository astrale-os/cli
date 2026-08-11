import chalk from 'chalk'

import type { KernelCommandOpts } from '../../kernel'
import type { CommandDefinition } from '../../program/index'

import { withAdminKernelClient } from '../../kernel/client'
import { adminInstanceMethod, type InstanceInfo } from '../../lib/admin-instance'
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
        withAdminKernelClient(
          opts,
          async (ctx) =>
            (await ctx.client.call(adminInstanceMethod('info'), { id })) as InstanceInfo,
        ),
      )
      if (isMachine(opts)) {
        output(result, opts)
        return
      }
      console.log(`${chalk.bold(result.slug)} ${chalk.dim(result.url)}`)
      if (result.state)
        log.dim(`  state: ${result.state}${result.phase ? ` (${result.phase})` : ''}`)
      if (result.error) log.dim(`  error: ${result.error}`)
      if (result.region) log.dim(`  region: ${result.region}`)
      if (result.hostId) log.dim(`  host: ${result.hostId}`)
      if (result.createdAt) log.dim(`  created: ${result.createdAt}`)
    } catch (e) {
      fatal(e, opts)
    }
  },
} satisfies CommandDefinition
