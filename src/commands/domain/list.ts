import chalk from 'chalk'

import type { KernelCommandOpts } from '../../connection'
import type { ListProjection, RawOutputOpts } from '../../lib/output'
import type { CommandDefinition } from '../../program/index'

import { listAdminDomains, type DomainInfo } from '../../lib/admin-domain'
import { ADMIN_TARGET_OPTIONS, type AdminTargetCommandOpts } from '../../lib/admin-target'
import { fatal, withSpinner } from '../../lib/log'
import { isMachine, presentList } from '../../lib/output'

type ListOpts = KernelCommandOpts &
  AdminTargetCommandOpts &
  RawOutputOpts & {
    check?: boolean
    defaultOnly?: boolean
    quiet?: boolean
    count?: boolean
    long?: boolean
    format?: 'yaml' | 'json'
  }

/** A catalog entry, optionally enriched with a live `--check` probe. */
export type DomainRow = DomainInfo & {
  reachable?: boolean
  schemaHash?: string
  checkError?: string | null
}

/**
 * Catalog rows for the human table. `paths` is the published URL (falling back
 * to origin) so `astrale domain list -q | xargs -I{} astrale domain install {}`
 * composes — install takes a URL. The STATUS column is dropped by `renderTable`
 * unless `--check` filled it in.
 */
export function domainProjection(items: DomainRow[]): ListProjection {
  return {
    columns: [
      { key: 'name', header: 'NAME', color: chalk.bold },
      { key: 'origin', header: 'ORIGIN', color: chalk.cyan },
      { key: 'url', header: 'URL', color: chalk.dim },
      { key: 'default', header: 'DEFAULT' },
      { key: 'status', header: 'STATUS' },
    ],
    rows: items.map((d) => ({
      name: d.name,
      origin: d.origin,
      url: d.url ?? chalk.dim('(unpublished)'),
      default: d.installByDefault ? chalk.green('default') : '',
      status: statusCell(d),
    })),
    paths: items.map((d) => d.url ?? d.origin),
  }
}

function statusCell(d: DomainRow): string {
  if (d.reachable === undefined) return ''
  return d.reachable ? chalk.green('● live') : chalk.red(`○ ${d.checkError ?? 'unreachable'}`)
}

export default {
  name: 'list',
  description: 'List domains published in the admin catalog (DomainEntry.list)',
  afterHelpText: `
Behavior:
  Reads the admin catalog — every domain that has been \`publish\`ed
  (origin → published worker URL). Listing only shows what is INSTALLABLE;
  what is actually mounted where lives on each instance's own graph
  (\`astrale ls /\` against that instance).

  Default output is a NAME/ORIGIN/URL/DEFAULT table on a TTY, JSON when piped
  or with --json/--raw (agent-friendly — full DomainInfo objects). -q prints
  one install URL per line (pipeable into \`domain install\`); --count prints
  only the number. --default-only keeps the install-by-default entries (what
  every new instance gets via alphaCreate). --check probes each published URL's
  /meta and adds a live/unreachable STATUS column (+ reachable/schemaHash in
  machine output).

  The admin kernel is selected like every admin op — the configured default,
  or --admin <bookmark> / --admin-url <url>.

Examples:
  $ astrale domain list
  $ astrale domain list --check
  $ astrale domain list --default-only -q
  $ astrale domain list --json | jq -r '.[].url'
`,
  options: [
    ...ADMIN_TARGET_OPTIONS,
    { flags: '--check', description: "Probe each domain's URL for reachability + schema hash" },
    { flags: '--default-only', description: 'Only show install-by-default domains' },
    { flags: '-q, --quiet', description: 'One install URL per line (unix-pipeable)' },
    { flags: '--count', description: 'Print only the number of published domains' },
    { flags: '-l, --long', description: 'Full catalog records in machine output' },
  ],
  action: async (opts: ListOpts) => {
    try {
      const domains = await withSpinner(
        'Fetching domains',
        !isMachine(opts),
        async (): Promise<DomainRow[]> => {
          const list = await listAdminDomains(opts)
          const filtered = opts.defaultOnly ? list.filter((d) => d.installByDefault) : list
          filtered.sort(byDefaultThenName)
          if (!opts.check) return filtered as DomainRow[]
          // Reachability is a direct client-side /meta fetch per entry, in
          // parallel — no admin round-trip, and version-independent of the
          // admin worker (mirrors `domain install`'s probeDeclaredOrigin).
          return Promise.all(filtered.map(probe))
        },
      )

      presentList(
        domains,
        { ...opts, quiet: opts.quiet, count: opts.count, long: opts.long },
        domainProjection,
      )
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition

/** Install-by-default first, then alphabetical by origin — a stable display order. */
export function byDefaultThenName(a: DomainInfo, b: DomainInfo): number {
  if (!!a.installByDefault !== !!b.installByDefault) return a.installByDefault ? -1 : 1
  return a.origin.localeCompare(b.origin)
}

/**
 * Enrich one entry with a reachability probe: fetch the published worker's
 * `/meta` (the same endpoint the admin `DomainEntry.check` hits) and read its
 * schema hash. A dead / missing url is itself a result, not a throw.
 */
async function probe(d: DomainInfo): Promise<DomainRow> {
  if (!d.url) return { ...d, reachable: false, checkError: 'no url published' }
  try {
    const res = await fetch(new URL('/meta', d.url), { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return { ...d, reachable: false, checkError: `meta HTTP ${res.status}` }
    const meta = (await res.json()) as { schemaHash?: unknown }
    return {
      ...d,
      reachable: true,
      ...(typeof meta.schemaHash === 'string' ? { schemaHash: meta.schemaHash } : {}),
      checkError: null,
    }
  } catch (err) {
    return { ...d, reachable: false, checkError: err instanceof Error ? err.message : String(err) }
  }
}
