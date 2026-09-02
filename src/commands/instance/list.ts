import { ResponseError } from '@astrale-os/sdk/client'
import chalk from 'chalk'

import type { KernelCommandOpts } from '../../connection'
import type { Column } from '../../lib/output'
import type { CommandDefinition } from '../../program/index'

import { AstraleError } from '../../errors'
import { listOwnedInstances } from '../../lib/admin-instance'
import {
  formatInstanceState,
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
    includeRetired?: boolean
  }

export type Bookmark = {
  name: string
  url: string | null
  issuer: string | null
  active: boolean
  defaultIdentity: string | null
  caFile: string | null
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
    {
      flags: '--include-retired',
      description: 'Include caller-visible retired Instance tombstones',
    },
  ],
  action: async (opts: ListOpts) => {
    try {
      if (opts.includeRetired && opts.bookmarked) {
        throw new AstraleError(
          'INVALID_FLAG',
          '--include-retired cannot be combined with --bookmarked.',
          'Retired Instance evidence comes from Admin, not local bookmarks.',
        )
      }
      const store = await readInstances()
      const bookmarks: Bookmark[] = Object.entries(store.instances).map(([name, entry]) => ({
        name,
        url: entry.url ?? null,
        issuer: entry.issuer ?? null,
        active: name === store.active,
        defaultIdentity: entry.defaultIdentity ?? null,
        caFile: entry.caFile ?? null,
        createdAt: entry.createdAt ?? null,
      }))

      let managed: OwnedInstanceInfo[] = []
      if (!opts.bookmarked) {
        try {
          managed = await withSpinner('Fetching instances', !isMachine(opts), () =>
            readAdminInventory(() => listOwnedInstances(opts, opts.includeRetired ?? false)),
          )
        } catch (error) {
          throw classifyAdminInventoryError(error)
        }
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

  const bookmarkByName = new Map<string, Bookmark & { url: string }>()
  if (show.managed && show.bookmarks) {
    for (const bookmark of bookmarks) {
      if (bookmark.url === null) continue
      bookmarkByName.set(bookmark.name, {
        ...bookmark,
        url: normalizeInstanceKernelUrl(bookmark.url),
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
        extra: [formatInstanceState(item), twin ? formatBookmarkConnection(twin) : '']
          .filter(Boolean)
          .join(' · '),
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
        extra: formatBookmarkConnection(item),
      })
    }
  }

  return rows
}

function formatBookmarkConnection(bookmark: Bookmark): string {
  return [
    bookmark.issuer && bookmark.issuer !== bookmark.url ? `issuer=${bookmark.issuer}` : '',
    bookmark.caFile ? `ca=${bookmark.caFile}` : '',
    bookmark.defaultIdentity ? `identity=${bookmark.defaultIdentity}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

const ADMIN_INVENTORY_CODES = new Set([
  'TOKEN_EXCHANGE_SOURCE_INVALID',
  'TOKEN_EXCHANGE_SOURCE_EXPIRED',
  'TOKEN_EXCHANGE_UNSUPPORTED',
  'TOKEN_EXCHANGE_DISCOVERY_FAILED',
  'TOKEN_EXCHANGE_PROTOCOL_ERROR',
  'TOKEN_EXCHANGE_INSECURE',
  'ADMIN_DOMAIN_ISSUER_MISSING',
])

const BACKEND_UNAVAILABLE = 5001

/** Retry one idempotent inventory read when the Kernel reports a transient backend failure. */
export async function readAdminInventory<Value>(read: () => Promise<Value>): Promise<Value> {
  try {
    return await read()
  } catch (cause) {
    if (!(cause instanceof ResponseError) || cause.code !== BACKEND_UNAVAILABLE) throw cause
    return read()
  }
}

/** Explain why Admin inventory failed without confusing backend faults with absent deployment. */
export function classifyAdminInventoryError(cause: unknown): AstraleError {
  const code = cause instanceof AstraleError ? cause.code : undefined
  if (code !== undefined && ADMIN_INVENTORY_CODES.has(code)) {
    return new AstraleError(
      'ADMIN_INVENTORY_UNAVAILABLE',
      'Managed instance listing needs the Admin Domain and an IdP-backed identity. Admin is not deployed in this environment.',
      'Use `astrale instance list --bookmarked` for local kernel bookmarks. Key-backed identities cannot mint an Admin Domain token.',
    )
  }
  if (cause instanceof ResponseError && cause.code === BACKEND_UNAVAILABLE) {
    return new AstraleError(
      'ADMIN_BACKEND_UNAVAILABLE',
      cause.message,
      'The Admin authentication backend failed twice. Retry the command; local bookmarks remain available with `astrale instance list --bookmarked`.',
      { cause },
    )
  }
  if (cause instanceof AstraleError) return cause
  return new AstraleError(
    'ADMIN_INVENTORY_FAILED',
    cause instanceof Error ? cause.message : String(cause),
    'Retry with `--debug`, or inspect local bookmarks with `astrale instance list --bookmarked`.',
    { cause },
  )
}
