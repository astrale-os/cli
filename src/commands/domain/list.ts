import chalk from 'chalk'

import type { KernelCommandOpts } from '../../connection'
import type { ListProjection, RawOutputOpts } from '../../lib/output'
import type { CommandDefinition } from '../../program/index'

import { formatKernelError } from '../../connection/errors'
import { AstraleError } from '../../errors'
import { listAdminDomains, type DomainInfo } from '../../lib/admin-domain'
import {
  ADMIN_TARGET_OPTIONS,
  FLEET_OPTION,
  type AdminTargetCommandOpts,
} from '../../lib/admin-target'
import { fetchDomainPublication } from '../../lib/domain-publication'
import { fatal, withSpinner } from '../../lib/log'
import { isMachine, output, presentList } from '../../lib/output'
import {
  listInstalled,
  renderInstalled,
  type InstalledListDependencies,
  type InstalledListV1,
} from './installed-list'

export type ListOpts = KernelCommandOpts &
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
  schemaRevision?: string
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

/** The Admin catalog options, which mean nothing for the Domains one instance runs. */
const CATALOG_ONLY: ReadonlyArray<readonly [keyof ListOpts, string]> = [
  ['check', '--check'],
  ['defaultOnly', '--default-only'],
  ['quiet', '-q/--quiet'],
  ['count', '--count'],
  ['long', '-l/--long'],
  ['fleet', '--fleet'],
]

/** The catalog options given beside -i/--url, which the instance listing refuses before any request. */
export function misplacedCatalogFlags(opts: ListOpts): string[] {
  return CATALOG_ONLY.filter(([key]) => opts[key] !== undefined && opts[key] !== false).map(
    ([, flag]) => flag,
  )
}

/**
 * `astrale domain list -i <instance>` / `--url <kernel>`: what runs on that instance (CT24
 * InstalledListV1). A person gets the [.79737] table on a TTY; --json, --ci or a pipe print the
 * document. A refusal exits 1, with its details in machine mode.
 */
export async function runInstalledList(
  opts: ListOpts,
  dependencies: Partial<InstalledListDependencies> = {},
): Promise<void> {
  const machine = isMachine(opts)
  const misplaced = misplacedCatalogFlags(opts)
  if (misplaced.length > 0) {
    fatal(
      new AstraleError(
        'INVALID_FLAG',
        `${misplaced.join(', ')} ${misplaced.length > 1 ? 'apply' : 'applies'} to the Admin catalog listing, not to -i/--url.`,
        'Run `astrale domain list` without -i/--url for the catalog, or drop the flag.',
      ),
      opts,
    )
  }
  let list: InstalledListV1
  try {
    list = await withSpinner('Reading installed Domains', !machine, () =>
      listInstalled(opts, dependencies),
    )
  } catch (error) {
    if (error instanceof AstraleError) fatal(error, opts)
    await formatKernelError(error, machine, undefined, opts.debug)
    process.exit(1)
  }
  if (machine) output(list, opts)
  else console.log(renderInstalled(list))
}

function statusCell(d: DomainRow): string {
  if (d.reachable === undefined) return ''
  return d.reachable ? chalk.green('● live') : chalk.red(`○ ${d.checkError ?? 'unreachable'}`)
}

export default {
  name: 'list',
  description: 'List what runs on an instance (-i/--url), or the Admin catalog',
  afterHelpText: `
Behavior:
  With -i <instance> or --url <kernel>, lists what runs on that instance:
  every installation the instance Kernel pins to a deployment and that the
  caller can read. ORIGIN, then VERSION, DIGEST and AVAILABLE:
    DIGEST     the pinned release digest, from the Kernel.
    VERSION    the registry version naming that exact release; else the
               version naming the same build from the same issuer, in the
               deployment's environment (1.5.0 · staging); else the
               deployment's name from its public record (1.4.2 + 7 commits ·
               a1b2c3d · staging), printed as computed; "legacy" for a
               v2/v3 Publication pin; "unknown" when nothing names it.
    AVAILABLE  the highest stable, non-yanked version above the installed
               one (or above the release a preview was built after).
  Versions come from the Admin registry, read with the caller's credential
  (--admin/--admin-url choose it); it is opened only when a release pin
  needs a version, and a registry that cannot be read fails the command.
  The listing is partial by nature: built-in and local Domains are never
  listed, nor Domains the caller cannot read, so an absent origin is
  unknown, not "not installed". --json, --ci or a pipe print one
  astrale.installed-list document. A Kernel that does not list installed
  releases (an older Host release) is refused with
  KERNEL_RELEASE_UNSUPPORTED, before Admin is contacted.

  Without -i/--url, reads the Fleet's admin catalog — the domains it
  contains and those it lists from another Fleet (origin → published
  worker URL), each once. Default output is a
  NAME/ORIGIN/URL/DEFAULT table on a TTY, JSON when piped or with
  --json/--raw (agent-friendly — full DomainInfo objects). -q prints one
  install URL per line (pipeable into \`domain install\`); --count prints
  only the number. --default-only keeps the install-by-default entries
  (what every new instance receives during Admin-managed provisioning).
  --check probes each published URL's canonical Publication and adds a
  live/unreachable STATUS column (+ reachable/schemaRevision in machine
  output). These catalog options are refused with -i/--url.

  The admin kernel is selected like every admin op — the configured default,
  or --admin <bookmark> / --admin-url <url>.

Examples:
  $ astrale domain list -i acme-prod
  $ astrale domain list -i acme-prod --json
  $ astrale domain list
  $ astrale domain list --check
  $ astrale domain list --default-only -q
  $ astrale domain list --json | jq -r '.[].url'
`,
  options: [
    ...ADMIN_TARGET_OPTIONS,
    FLEET_OPTION,
    {
      flags: '--check',
      description: "Probe each domain's canonical Publication + schema revision",
    },
    { flags: '--default-only', description: 'Only show install-by-default domains' },
    { flags: '-q, --quiet', description: 'One install URL per line (unix-pipeable)' },
    { flags: '--count', description: 'Print only the number of published domains' },
    { flags: '-l, --long', description: 'Full catalog records in machine output' },
  ],
  action: async (opts: ListOpts) => {
    if (opts.instance !== undefined || opts.url !== undefined) {
      await runInstalledList(opts)
      return
    }
    try {
      const domains = await withSpinner(
        'Fetching domains',
        !isMachine(opts),
        async (): Promise<DomainRow[]> => {
          const list = await listAdminDomains(opts)
          const filtered = opts.defaultOnly ? list.filter((d) => d.installByDefault) : list
          filtered.sort(byDefaultThenName)
          if (!opts.check) return filtered as DomainRow[]
          // Reachability is a direct client-side Publication fetch per entry, in
          // parallel — no admin round-trip, and version-independent of the
          // admin worker (mirrors probeDeclaredOrigin of `domain/legacy/identity-override.ts`).
          return Promise.all(filtered.map(probe))
        },
      )

      presentList(
        domains,
        { ...opts, quiet: opts.quiet, count: opts.count, long: opts.long },
        domainProjection,
      )
    } catch (e) {
      await formatKernelError(e, isMachine(opts), undefined, opts.debug)
      process.exit(1)
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
 * canonical Publication and read its schema revision. A dead or missing URL is
 * itself a result, not a throw.
 */
export async function probe(d: DomainInfo): Promise<DomainRow> {
  if (!d.url) return { ...d, reachable: false, checkError: 'no url published' }
  try {
    const deployed = await fetchDomainPublication(d.url, AbortSignal.timeout(10_000))
    if (deployed.origin !== d.origin) {
      throw new Error(`Domain origin mismatch: deployed=${deployed.origin} expected=${d.origin}`)
    }
    return {
      ...d,
      reachable: true,
      schemaRevision: deployed.schema.revision,
      checkError: null,
    }
  } catch (err) {
    return { ...d, reachable: false, checkError: err instanceof Error ? err.message : String(err) }
  }
}
