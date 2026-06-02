import chalk from 'chalk'

import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { withAdminKernelClient } from '../../kernel/client'
import { ADMIN_KERNEL_INSTANCE, type AdminKernelInstanceInfo } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { fatal, log } from '../../lib/log'
import { isRawOutput, output, type RawOutputOpts } from '../../lib/output'

type StatusOpts = KernelCommandOpts & AdminTargetCommandOpts & RawOutputOpts

export default {
  name: 'status',
  description: 'Show admin instance status',
  arguments: [{ name: 'id', description: 'Instance id', required: true }],
  options: [...ADMIN_TARGET_OPTIONS],
  action: async (id: string, opts: StatusOpts) => {
    try {
      const result = await withAdminKernelClient(
        opts,
        async (ctx) =>
          (await ctx.client.call(`${ADMIN_KERNEL_INSTANCE}/info`, {
            id,
          })) as AdminKernelInstanceInfo,
      )
      if (isRawOutput(opts)) {
        output(result, opts)
        return
      }
      const status =
        result.status === 'ready'
          ? chalk.green(result.status)
          : result.status === 'failed'
            ? chalk.red(result.status)
            : chalk.yellow(result.status)
      console.log(`${chalk.bold(result.id)} [${status}]`)
      log.dim(`  issuer: ${result.issuer}`)
      log.dim(`  owner: ${result.ownerUserId}`)
      log.dim(`  distribution: ${result.distributionInstalled ? 'installed' : 'missing'}`)
      log.dim(`  user: ${result.userSeeded ? 'seeded' : 'not seeded'}`)
      if (result.error) log.dim(`  error: ${result.error}`)
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
