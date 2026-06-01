import chalk from 'chalk'

import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { withKernelClient } from '../../kernel/client'
import { ADMIN_KERNEL_INSTANCE, type AdminKernelInstanceInfo } from '../../lib/admin-instance'
import { readInstances } from '../../lib/instance'
import { fatal, log } from '../../lib/log'
import { isRawOutput, output, type RawOutputOpts } from '../../lib/output'

type ListOpts = KernelCommandOpts &
  RawOutputOpts & {
    bookmarked?: boolean
    adminOnly?: boolean
  }

export default {
  name: 'list',
  description: 'List admin-managed instances and local bookmarks',
  options: [
    { flags: '--bookmarked', description: 'Only show locally bookmarked kernel connections' },
    { flags: '--admin-only', description: 'Only show instances returned by the admin kernel' },
  ],
  action: async (opts: ListOpts) => {
    try {
      const store = await readInstances()
      const bookmarks = Object.entries(store.instances).map(([name, entry]) => ({
        name,
        url: entry.url ?? null,
        issuer: entry.issuer ?? null,
        active: name === store.active,
        defaultIdentity: entry.defaultIdentity ?? null,
        createdAt: entry.createdAt ?? null,
      }))

      let managed: AdminKernelInstanceInfo[] = []
      if (!opts.bookmarked) {
        managed = await withKernelClient(
          opts,
          async (ctx) =>
            (await ctx.client.call(
              `${ADMIN_KERNEL_INSTANCE}/list`,
              {},
            )) as AdminKernelInstanceInfo[],
        )
      }

      if (isRawOutput(opts)) {
        output(
          {
            active: store.active || null,
            ...(opts.adminOnly ? {} : { bookmarks }),
            ...(opts.bookmarked ? {} : { instances: managed }),
          },
          opts,
        )
        return
      }

      if (!opts.bookmarked) {
        for (const item of managed) {
          const status =
            item.status === 'ready'
              ? chalk.green(item.status)
              : item.status === 'failed'
                ? chalk.red(item.status)
                : chalk.yellow(item.status)
          console.log(`${chalk.bold(item.id)} ${chalk.dim(`<admin-managed>`)} [${status}]`)
          log.dim(`  issuer: ${item.issuer}`)
          if (item.error) log.dim(`  error: ${item.error}`)
        }
      }

      if (!opts.adminOnly) {
        for (const item of bookmarks) {
          const marker = item.active ? chalk.green(' *') : ''
          console.log(
            `${chalk.bold(item.name)} ${chalk.dim('<bookmark>')} ${chalk.dim(String(item.url))}${marker}`,
          )
        }
      }

      if ((opts.bookmarked || managed.length === 0) && bookmarks.length === 0) {
        log.dim('  No bookmarked instances. Run: astrale instance bookmark <name> --url <url>')
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
