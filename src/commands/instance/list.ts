import chalk from 'chalk'

import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'
import type { Column } from '../../lib/output'

import { withAdminKernelClient } from '../../kernel/client'
import { ADMIN_INSTANCE, type InstanceInfo } from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { readInstances } from '../../lib/instance'
import { fatal, log, withSpinner } from '../../lib/log'
import { isMachine, output, type RawOutputOpts } from '../../lib/output'
import { renderTable } from '../../lib/table'

type ListOpts = KernelCommandOpts &
  AdminTargetCommandOpts &
  RawOutputOpts & {
    bookmarked?: boolean
    adminOnly?: boolean
  }

type Bookmark = {
  name: string
  url: string | null
  issuer: string | null
  active: boolean
  defaultIdentity: string | null
  createdAt: string | null
}

const COLUMNS: Column[] = [
  { key: 'name', header: 'NAME', color: chalk.bold },
  { key: 'kind', header: 'KIND', color: chalk.dim },
  { key: 'url', header: 'URL', color: chalk.dim },
  { key: 'extra', header: '', color: chalk.dim },
]

export default {
  name: 'list',
  description: 'List admin-managed instances and local bookmarks',
  options: [
    ...ADMIN_TARGET_OPTIONS,
    { flags: '--bookmarked', description: 'Only show locally bookmarked kernel connections' },
    { flags: '--admin-only', description: 'Only show instances returned by the admin kernel' },
  ],
  action: async (opts: ListOpts) => {
    try {
      const store = await readInstances()
      const bookmarks: Bookmark[] = Object.entries(store.instances).map(([name, entry]) => ({
        name,
        url: entry.url ?? null,
        issuer: entry.issuer ?? null,
        active: name === store.active,
        defaultIdentity: entry.defaultIdentity ?? null,
        createdAt: entry.createdAt ?? null,
      }))

      let managed: InstanceInfo[] = []
      if (!opts.bookmarked) {
        managed = await withSpinner('Fetching instances', !isMachine(opts), () =>
          withAdminKernelClient(
            opts,
            async (ctx) => (await ctx.client.call(`${ADMIN_INSTANCE}/list`, {})) as InstanceInfo[],
          ),
        )
      }

      if (isMachine(opts)) {
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

      const rows: Array<Record<string, string>> = []
      if (!opts.bookmarked) {
        for (const item of managed) {
          rows.push({
            name: item.slug,
            kind: 'managed',
            url: item.url ?? '',
            extra: [item.region, item.hostId].filter(Boolean).join(' · '),
          })
        }
      }
      if (!opts.adminOnly) {
        for (const item of bookmarks) {
          rows.push({
            name: item.active ? `${item.name} ${chalk.green('*')}` : item.name,
            kind: 'bookmark',
            url: String(item.url ?? ''),
            extra: '',
          })
        }
      }

      if (rows.length === 0) {
        log.dim('  No instances. Run: astrale instance bookmark <name> --url <url>')
        return
      }
      process.stdout.write(renderTable(rows, { columns: COLUMNS }) + '\n')
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
