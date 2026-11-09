import { ResponseError, retryAfterOf } from '@astrale-os/sdk/client'
import chalk from 'chalk'

import type { KernelCommandOpts } from '../../connection'
import type { DirectoryInstance, DirectoryReadOptions } from '../../lib/admin/directory'
import type { Column } from '../../lib/terminal/table'
import type { CommandDefinition } from '../../program/index'

import { formatInstanceState, type InstanceInfo } from '../../admin/instance'
import { AstraleError } from '../../errors'
import {
  describeAge,
  readCachedInstanceDirectory,
  type DirectoryRead,
} from '../../lib/admin/directory-cache'
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
import { log, withSpinner } from '../../lib/terminal/log'
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
  description:
    'List your instances (every organization you belong to) and local bookmarks; --admin-only, --fleet and --include-retired read the Admin inventory',
  options: [
    ...ADMIN_TARGET_OPTIONS,
    FLEET_OPTION,
    { flags: '--bookmarked', description: 'Only show locally bookmarked kernel connections' },
    {
      flags: '--admin-only',
      description:
        'Only show the Admin inventory (operators): state, Fleet and ownership; needs an Admin account',
    },
    {
      flags: '--include-retired',
      description: 'Include caller-visible retired Instance tombstones',
    },
  ],
  action: async (opts: ListOpts) => {
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

    // Without an operator option, the list is the user's own instances, from the directory.
    if (!opts.bookmarked && !needsAdminInventory(opts)) {
      await listDirectory(opts, store.active || null, bookmarks)
      return
    }

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
  },
} satisfies CommandDefinition

/** Operator views: state, Fleets, retired Instances and ownership come from the Admin inventory. */
export function needsAdminInventory(
  opts: Pick<ListOpts, 'adminOnly' | 'fleet' | 'includeRetired'>,
): boolean {
  return opts.adminOnly === true || opts.fleet !== undefined || opts.includeRetired === true
}

/**
 * The user's instances from the directory, then their bookmarks. When the directory fails, the
 * bookmarks are still listed with a warning; with no bookmark to show, the failure is the result.
 */
export async function listDirectory(
  opts: ListOpts,
  active: string | null,
  bookmarks: Bookmark[],
  read: (
    options: DirectoryReadOptions,
    mode: 'refresh' | 'prefer-fresh',
  ) => Promise<DirectoryRead> = readCachedInstanceDirectory,
): Promise<void> {
  const machine = isMachine(opts)
  let result: DirectoryRead | undefined
  let failure: AstraleError | undefined
  try {
    // The listing is always read afresh; the last one stands in only while the directory fails.
    result = await withSpinner('Fetching instances', !machine, () =>
      read(
        {
          ...(opts.admin === undefined ? {} : { admin: opts.admin }),
          ...(opts.adminUrl === undefined ? {} : { adminUrl: opts.adminUrl }),
          ...(opts.domainIssuer === undefined ? {} : { domainIssuer: opts.domainIssuer }),
          ...(opts.as === undefined ? {} : { as: opts.as }),
          ...(opts.timeout === undefined ? {} : { timeout: opts.timeout }),
        },
        'refresh',
      ),
    )
  } catch (error) {
    if (!(error instanceof AstraleError) || bookmarks.length === 0) throw error
    failure = error
  }
  const directory = result?.directory
  const stale = result?.stale
  const instances = directory?.instances ?? []
  if (machine) {
    output(
      {
        active,
        bookmarks,
        instances,
        truncated: directory?.truncated ?? false,
        directory:
          failure !== undefined
            ? { status: 'unavailable', code: failure.code, message: failure.message }
            : stale !== undefined
              ? {
                  status: 'stale',
                  listedAt: stale.listedAt,
                  code: stale.code,
                  message: stale.message,
                }
              : { status: 'ok' },
      },
      opts,
    )
    return
  }
  if (failure !== undefined) {
    log.warn(`${failure.message} Showing bookmarks only.`)
    if (failure.hint) log.dim(`  ${failure.hint}`)
  }
  if (stale !== undefined) {
    log.warn(
      `${stale.message} Showing your instance list from ${new Date(stale.listedAt).toLocaleString()} (${describeAge(stale.listedAt)} ago).`,
    )
  }
  if (directory?.truncated) {
    log.warn('You belong to more organizations than one listing returns; some are not shown.')
  }
  const rows = buildDirectoryRows(instances, bookmarks)
  if (rows.length === 0) {
    log.dim(
      '  No instances. Ask to be invited into one, or run: astrale instance bookmark <name> --url <url>',
    )
    return
  }
  process.stdout.write(renderTable(rows, { columns: DIRECTORY_COLUMNS }) + '\n')
}

const DIRECTORY_COLUMNS: Column[] = [
  { key: 'name', header: 'NAME', color: chalk.bold },
  { key: 'region', header: 'REGION', color: chalk.dim },
  { key: 'url', header: 'URL', color: chalk.dim },
  { key: 'organization', header: 'ORGANIZATION' },
  { key: 'source', header: 'SOURCE', color: chalk.dim },
]

/**
 * One row per instance. A bookmark whose kernel URL is a directory instance's merges into that
 * row: the directory's slug names it, the bookmark adds its active marker, and its own name when
 * it differs. Every other bookmark gets its own row.
 */
export function buildDirectoryRows(
  instances: readonly DirectoryInstance[],
  bookmarks: readonly Bookmark[],
): Array<Record<string, string>> {
  const byUrl = new Map<string, Bookmark>()
  for (const bookmark of bookmarks) {
    if (bookmark.url === null) continue
    const url = normalizeInstanceKernelUrl(bookmark.url)
    // Two bookmarks of one instance: the active one wins the merge, the other keeps its own row.
    if (!byUrl.has(url) || bookmark.active) byUrl.set(url, bookmark)
  }
  const merged = new Set<Bookmark>()
  const rows: Array<Record<string, string>> = instances.map((instance) => {
    const twin = byUrl.get(normalizeInstanceKernelUrl(instance.url))
    if (twin !== undefined) merged.add(twin)
    const name =
      twin !== undefined && twin.name !== instance.slug
        ? `${instance.slug} (bookmark ${twin.name})`
        : instance.slug
    return {
      name: twin?.active ? `${name} ${chalk.green('*')}` : name,
      region: instance.region ?? '',
      url: instance.url,
      organization: instance.name,
      source: 'workos',
    }
  })
  for (const bookmark of bookmarks) {
    if (merged.has(bookmark)) continue
    rows.push({
      name: bookmark.active ? `${bookmark.name} ${chalk.green('*')}` : bookmark.name,
      region: '',
      url: bookmark.url ?? '',
      organization: '',
      source: 'bookmark',
    })
  }
  return rows
}

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
      'The Admin inventory needs the Admin Domain and an IdP-backed identity. Admin is not deployed in this environment.',
      'Without --admin-only, --fleet or --include-retired, `astrale instance list` reads your instances without Admin; `astrale instance list --bookmarked` shows local kernel bookmarks. Key-backed identities cannot mint an Admin Domain token.',
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
