import chalk from 'chalk'

import type { KernelCommandOpts } from '../../kernel'
import type { Column } from '../../lib/output'
import type { CommandDefinition } from '../../program/index'

import { listOwnedInstances } from '../../kernel/client'
import {
  formatInstanceLocation,
  type InstanceInfo,
  type OwnedInstanceInfo,
} from '../../lib/admin-instance'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { normalizeInstanceKernelUrl, readInstances } from '../../lib/instance'
import { fatal, log, withSpinner } from '../../lib/log'
import { isMachine, output, type RawOutputOpts } from '../../lib/output'
import { renderTable } from '../../lib/table'

type ListOpts = KernelCommandOpts &
  AdminTargetCommandOpts &
  RawOutputOpts & {
    bookmarked?: boolean
    adminOnly?: boolean
  }

export type Bookmark = {
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

      let managed: OwnedInstanceInfo[] = []
      if (!opts.bookmarked) {
        managed = await withSpinner('Fetching instances', !isMachine(opts), () =>
          listOwnedInstances(opts),
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

      const rows = buildInstanceRows(managed, bookmarks, {
        managed: !opts.bookmarked,
        bookmarks: !opts.adminOnly,
      })

      if (rows.length === 0) {
        log.dim('  No instances. Run: astrale instance bookmark <name> --url <url>')
        return
      }
      process.stdout.write(renderTable(rows, { columns: COLUMNS }) + '\n')
    } catch (e) {
      fatal(e, opts)
    }
  },
} satisfies CommandDefinition

/**
 * One row per instance. A bookmark that points at a managed instance (same
 * name and same kernel URL) merges into the managed row — carrying the active
 * marker — instead of listing the instance twice.
 */
export function buildInstanceRows(
  managed: InstanceInfo[],
  bookmarks: Bookmark[],
  show: { managed: boolean; bookmarks: boolean },
): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = []
  const merged = new Set<string>()

  const bookmarkByName = new Map<string, { url: string; active: boolean }>()
  if (show.managed && show.bookmarks) {
    for (const bookmark of bookmarks) {
      if (bookmark.url === null) continue
      bookmarkByName.set(bookmark.name, {
        url: normalizeInstanceKernelUrl(bookmark.url),
        active: bookmark.active,
      })
    }
  }

  if (show.managed) {
    for (const item of managed) {
      const candidate = item.url ? bookmarkByName.get(item.slug) : undefined
      const twin =
        candidate && item.url && candidate.url === normalizeInstanceKernelUrl(item.url)
          ? candidate
          : undefined
      if (twin) merged.add(item.slug)
      rows.push({
        name: twin?.active ? `${item.slug} ${chalk.green('*')}` : item.slug,
        kind: 'managed',
        url: item.url ?? '',
        extra: formatInstanceLocation(item),
      })
    }
  }

  if (show.bookmarks) {
    for (const item of bookmarks) {
      if (merged.has(item.name)) continue
      rows.push({
        name: item.active ? `${item.name} ${chalk.green('*')}` : item.name,
        kind: 'bookmark',
        url: String(item.url ?? ''),
        extra: '',
      })
    }
  }

  return rows
}
