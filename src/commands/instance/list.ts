import chalk from 'chalk'

import type { CommandDefinition } from '../../command'

import { readConfig } from '../../lib/config'
import {
  getManagerInstances,
  managerUrl,
  readInstances,
  type InstanceEntry,
  type InstanceKind,
  type ManagerInstance,
} from '../../lib/instance'
import { log } from '../../lib/log'
import { RAW_OUTPUT_OPTIONS, isRawOutput, output, type RawOutputOpts } from '../../lib/output'

type ListFilters = {
  local?: boolean
  managed?: boolean
  bookmarked?: boolean
  bookmarkedLocal?: boolean
  bookmarkedCloud?: boolean
}

function hasAnyFilter(filters: ListFilters): boolean {
  return !!(
    filters.local ||
    filters.managed ||
    filters.bookmarked ||
    filters.bookmarkedLocal ||
    filters.bookmarkedCloud
  )
}

function matchesFilter(
  kind: InstanceKind,
  mode: string | undefined,
  filters: ListFilters,
): boolean {
  if (filters.local && (kind === 'manager' || kind === 'local-child')) return true
  if (filters.managed && kind === 'managed-cloud') return true
  if (filters.bookmarked && kind === 'bookmark') return true
  if (filters.bookmarkedLocal && kind === 'bookmark' && mode === 'local') return true
  if (filters.bookmarkedCloud && kind === 'bookmark' && mode === 'remote') return true
  return false
}

function inferKind(entry: InstanceEntry, key: string): InstanceKind {
  if (entry.kind) return entry.kind
  if (key === 'manager') return 'manager'
  return entry.url ? 'bookmark' : 'local-child'
}

export default {
  name: 'list',
  description: 'List all registered instances (§6)',
  options: [
    { flags: '--local', description: 'Manager + local children only' },
    { flags: '--managed', description: 'Astrale cloud managed instances only' },
    { flags: '--bookmarked', description: 'All bookmarks (local + cloud)' },
    { flags: '--bookmarked-local', description: 'Bookmarks stored on this machine only' },
    { flags: '--bookmarked-cloud', description: 'Bookmarks synced via astrale cloud' },
    ...RAW_OUTPUT_OPTIONS,
  ],
  action: async (opts: RawOutputOpts & ListFilters) => {
    const isRaw = isRawOutput(opts)
    let discoveryError: Error | undefined
    const [config, store, discovered] = await Promise.all([
      readConfig(),
      readInstances(),
      getManagerInstances().catch((e) => {
        discoveryError = e instanceof Error ? e : new Error(String(e))
        return [] as ManagerInstance[]
      }),
    ])

    if (discoveryError && !isRaw) {
      log.warn(`Could not discover instances from manager: ${discoveryError.message}`)
    }

    const filtering = hasAnyFilter(opts)
    const matches = (kind: InstanceKind, mode: string | undefined) =>
      !filtering || matchesFilter(kind, mode, opts)

    type Row = {
      key: string
      label?: string
      url?: string
      issuer?: string
      status?: string
      kind: InstanceKind
      mode?: string
      source: 'store' | 'discovered'
    }
    const merged = new Map<string, Row>()

    for (const [key, entry] of Object.entries(store.instances)) {
      const kind = inferKind(entry, key)
      if (!matches(kind, entry.mode)) continue
      // Per-kind URL provenance:
      //  - bookmark: entry.url (source of truth for remotes)
      //  - manager: derived from config (the local manager is always us)
      //  - local-child: merged from the discovered snapshot below
      let url: string | undefined
      let issuer: string | undefined
      if (kind === 'bookmark') {
        url = entry.url
        issuer = entry.issuer
      } else if (kind === 'manager') {
        url = managerUrl(config)
        issuer = config.issuer
      }
      merged.set(key, {
        key,
        label: entry.name,
        url,
        issuer,
        kind,
        mode: entry.mode,
        source: 'store',
      })
    }

    for (const inst of discovered) {
      const existing = merged.get(inst.id)
      if (existing) {
        existing.status = inst.status ?? existing.status
        existing.label ??= inst.label
        existing.url ??= inst.url
        existing.issuer ??= inst.issuer
      } else if (matches('local-child', undefined)) {
        // Kernel-side instance not yet bookmarked locally (e.g., registered
        // directly via syscall). Surface it so the user can `astrale use` it.
        merged.set(inst.id, {
          key: inst.id,
          label: inst.label,
          url: inst.url,
          issuer: inst.issuer,
          status: inst.status ?? 'unknown',
          kind: 'local-child',
          source: 'discovered',
        })
      }
    }

    // Orphan detection: local-child entries the manager no longer knows.
    // The manager is source of truth — flag so the user can clean up.
    if (!discoveryError) {
      for (const row of merged.values()) {
        if (row.kind === 'local-child' && row.source === 'store' && !row.url) {
          row.status = 'orphan-local'
        }
      }
    }

    if (isRaw) {
      const items = Array.from(merged.values()).map((info) => ({
        name: info.key,
        label: info.label ?? null,
        url: info.url ?? null,
        issuer: info.issuer ?? null,
        kind: info.kind,
        mode: info.mode ?? null,
        status: info.status ?? 'unknown',
        active: info.key === store.active,
      }))
      output({ active: store.active, instances: items }, opts)
      return
    }

    if (merged.size === 0) {
      log.dim('  No instances matching filters. Run: astrale instance bookmark <name> --url <url>')
      return
    }

    for (const info of merged.values()) {
      const isActive = info.key === store.active
      const marker = isActive ? chalk.green(' *') : ''
      const status = info.status ? chalk.dim(` [${info.status}]`) : ''
      const kindTag = chalk.dim(` <${info.kind}>`)
      const detail = info.url ? chalk.dim(` (${info.url})`) : chalk.dim(' (local)')
      // §4.7: display as "<label> (<slug>)" when both exist.
      const header = info.label
        ? `${chalk.bold(info.label)} ${chalk.dim(`(${info.key})`)}`
        : chalk.bold(info.key)
      console.log(`  ${header}${detail}${kindTag}${status}${marker}`)
    }
  },
} satisfies CommandDefinition
