import { ResponseError, retryAfterOf } from '@astrale-os/sdk/client'
import chalk from 'chalk'

import type { KernelCommandOpts } from '../../connection'
import type { Column } from '../../lib/terminal/table'
import type { CommandDefinition } from '../../program/index'

import { formatInstanceState, type InstanceInfo } from '../../admin/instance'
import { AstraleError } from '../../errors'
import {
  listInstanceInventory,
  listInstanceInventoryWithOwnership,
} from '../../lib/admin/instances'
import {
  ADMIN_TARGET_OPTIONS,
  FLEET_OPTION,
  type AdminTargetCommandOpts,
} from '../../lib/admin/target'
import { normalizeInstanceKernelUrl, readInstances } from '../../lib/instance/bookmarks'
import { ADMIN_UNREACHABLE_CODES } from '../../lib/instance/target'
import { fatal, log, withSpinner } from '../../lib/terminal/log'
import { isMachine, output, type RawOutputOpts } from '../../lib/terminal/output'
import { renderTable } from '../../lib/terminal/table'

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
    FLEET_OPTION,
    { flags: '--bookmarked', description: 'Only show locally bookmarked kernel connections' },
    { flags: '--admin-only', description: 'Only show instances returned by the admin kernel' },
    {
      flags: '--include-retired',
      description: 'Include caller-visible retired Instance tombstones',
    },
  ],
  action: async (opts: ListOpts) => {
    try {
      if (opts.fleet !== undefined && opts.bookmarked) {
        throw new AstraleError(
          'INVALID_FLAG',
          '--fleet cannot be combined with --bookmarked.',
          'Fleet selection applies to Admin-managed instances.',
        )
      }
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

      let managed: InstanceInfo[] = []
      if (!opts.bookmarked) {
        // Machine output also says which Instances the caller owns in the Admin sense, decided
        // in the same Admin session: Studio works only with those.
        const read = isMachine(opts) ? listInstanceInventoryWithOwnership : listInstanceInventory
        try {
          managed = await withSpinner('Fetching instances', !isMachine(opts), () =>
            readAdminInventory(() => read(opts, opts.includeRetired ?? false)),
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

const BACKEND_UNAVAILABLE = 5001
const ADMIN_INVENTORY_RETRY_DELAYS_MS = Object.freeze([100, 300, 900, 1_700])

type AdminInventoryRetryDependencies = Readonly<{
  retryDelaysMs?: readonly number[]
  sleep?: (milliseconds: number) => Promise<void>
}>

/**
 * Retry the idempotent inventory read through a short, bounded backend recovery window. A refusal
 * with a retry delay was already resent until its request deadline by the Session's transport, so
 * it is not read again.
 */
export async function readAdminInventory<Value>(
  read: () => Promise<Value>,
  dependencies: AdminInventoryRetryDependencies = {},
): Promise<Value> {
  const retryDelaysMs = dependencies.retryDelaysMs ?? ADMIN_INVENTORY_RETRY_DELAYS_MS
  const sleep = dependencies.sleep ?? wait

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await read()
    } catch (cause) {
      const retryDelayMs = retryDelaysMs[attempt]
      if (
        !(cause instanceof ResponseError) ||
        cause.code !== BACKEND_UNAVAILABLE ||
        retryAfterOf(cause) !== undefined ||
        retryDelayMs === undefined
      ) {
        throw cause
      }
      await sleep(retryDelayMs)
    }
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** Explain why Admin inventory failed without confusing backend faults with absent deployment. */
export function classifyAdminInventoryError(cause: unknown): AstraleError {
  const code = cause instanceof AstraleError ? cause.code : undefined
  if (code !== undefined && ADMIN_UNREACHABLE_CODES.has(code)) {
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
      'The read-only Admin inventory remained unavailable across bounded retries. Retry later; local bookmarks remain available with `astrale instance list --bookmarked`.',
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
