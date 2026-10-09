/**
 * The Fleet catalog listing of `astrale domain list`: every catalog entry the caller can read
 * (origin -> discovery URL), install-by-default first, with an optional live `--check` probe.
 *
 * @deprecated Successor: `astrale domain versions <origin>`, which lists a Domain's published
 * versions from the Domain version registry. The Fleet catalog stays the only source of a Fleet's
 * default Domains until catalogue and provisioning by version ship. Short-term consumer: operators
 * who keep a Fleet's defaults (`astrale domain list --default-only`). Removal: see
 * `./fleet-catalog.ts`.
 */
import chalk from 'chalk'

import type { KernelCommandOpts } from '../../../connection'
import type { AdminTargetCommandOpts } from '../../../lib/admin-target'
import type { ListProjection, RawOutputOpts } from '../../../lib/output'

import { formatKernelError } from '../../../connection/errors'
import { fetchDomainPublication } from '../../../lib/domain-publication'
import { withSpinner } from '../../../lib/log'
import { isMachine, presentList } from '../../../lib/output'
import { warnFleetCatalogDeprecated } from './catalog-deprecation'
import { listAdminDomains, type DomainInfo } from './fleet-catalog'

export type CatalogListOpts = KernelCommandOpts &
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

function statusCell(d: DomainRow): string {
  if (d.reachable === undefined) return ''
  return d.reachable ? chalk.green('● live') : chalk.red(`○ ${d.checkError ?? 'unreachable'}`)
}

/**
 * List the Fleet catalog: one bounded Admin read, filtered and sorted, then rendered as a table for
 * a person or as DomainInfo rows for machines. A failure exits 1 with its diagnostic.
 */
export async function listFleetCatalog(opts: CatalogListOpts): Promise<void> {
  warnFleetCatalogDeprecated('list', opts)
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
        // admin worker (mirrors probeDeclaredOrigin of `./identity-override.ts`).
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
}

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
