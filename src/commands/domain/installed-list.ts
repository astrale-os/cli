import type { InstalledPin, InstalledRelease } from '@astrale-os/sdk/client/schema'
import type { DeploymentRecordV1 } from '@astrale-os/sdk/deployment/address'

import { acceptVersion, deploymentName } from '@astrale-os/sdk/versioning'
import chalk from 'chalk'

import type { AdminRegistryApi, PublicationSummaryV1 } from '../../admin/registry'
import type { AdminConnectionOptions, ConnectionContext, KernelCommandOpts } from '../../connection'
import type { AdminTargetCommandOpts } from '../../lib/admin-target'

import { compareVersions, connectAdminRegistry, RegistryError } from '../../admin/registry'
import { adminSessionOptions, withAdminClientSession, withClientSession } from '../../connection'
import { mapBounded } from '../../lib/concurrency'
import { readDeploymentRecord, type RecordedInstallation } from '../../lib/deployment-record'
import { renderTable } from '../../lib/table'
import { installedReleases } from './release-install'

/**
 * What runs on one instance (Résolution [.79716] [.80228], overview [.112991]), as `astrale domain
 * list -i <instance> --json` prints it (CT24): the digest comes from the Kernel pin, the version
 * from the Admin registry, the name of a preview from its deployment record.
 */
export interface InstalledListV1 {
  readonly format: 'astrale.installed-list'
  readonly version: 1
  /** The instance Kernel URL that answered the listing. */
  readonly kernel: string
  /**
   * Always true: the Kernel lists only the ready installations pinned to a deployment that the
   * caller can read (AM-83, AM-84) and its answer carries no completeness marker, so an origin
   * absent from `domains` is unknown, never "not installed". Built-in and local Domains are never
   * listed.
   */
  readonly partial: boolean
  readonly domains: readonly InstalledDomainV1[]
}

export interface InstalledDomainV1 {
  readonly origin: string
  readonly revision: string
  readonly issuer: string
  readonly url: string
  readonly pin: InstalledPin
  /**
   * The registry version naming this exact release (`1.5.0`), else the version naming the same
   * build from the same origin and issuer, in the deployment's environment (`1.5.0 · staging`).
   * A build digest alone never names a version (AM-73).
   */
  readonly version?: string
  /**
   * The deployment's name, printed verbatim (AM-57): the version naming it, else the CT28
   * `deploymentName` of its record (`1.4.2 + 7 commits · a1b2c3d · staging`); `unknown` for a
   * release no Publication and no record names.
   */
  readonly name: string
  /** The highest stable, non-yanked version above the installed one, when one is known. */
  readonly available?: string
}

/** The name of a release pin that neither a Publication nor a record names. */
export const UNKNOWN_NAME = 'unknown'

/** Deployment records read at once; each is one GET to the deployment's dispatcher. */
const RECORD_READS = 6
/** Registry indexes read at once; each is one Query on Admin's graph. */
const REGISTRY_READS = 4

/**
 * Describe one installation from the Publications of its origin the caller can read and the
 * record of its deployment, when one was admitted for it. Only a Publication naming the exact
 * release, or naming the same build from the same issuer, names the deployment: a tenant of a
 * frozen Services Worker can declare any build digest, so a build named by another issuer is never
 * taken as this one (AM-73).
 */
export function describeInstalled(
  installed: InstalledRelease,
  publications: readonly PublicationSummaryV1[],
  record: DeploymentRecordV1 | undefined,
): InstalledDomainV1 {
  const base = {
    origin: installed.origin,
    revision: installed.revision,
    issuer: installed.issuer,
    url: installed.url,
    pin: installed.pin,
  }
  const pin = installed.pin
  const exact = publications.filter((entry) => entry.releaseDigest === pin.release)
  const sameBuild =
    exact.length > 0
      ? []
      : publications.filter(
          (entry) => entry.buildDigest === pin.build && sameIssuer(entry.url, installed.issuer),
        )
  const naming = exact.length > 0 ? exact : sameBuild
  const named = highestVersion(naming)
  const deployment = {
    // Without a record the environment is unknown: deploymentName renders it `?`.
    environment: record?.environment ?? '',
    releaseDigest: pin.release,
    buildDigest: pin.build,
    commit: record?.commit ?? null,
  }
  const version = named === undefined ? undefined : deploymentName(deployment, naming)
  const name = version ?? (record === undefined ? UNKNOWN_NAME : deploymentName(record, []))
  const floor = named ?? baseVersion(record)
  const available = floor === undefined ? undefined : availableAbove(publications, floor)
  return Object.freeze({
    ...base,
    ...(version === undefined ? {} : { version }),
    name,
    ...(available === undefined ? {} : { available }),
  })
}

/**
 * The highest version naming a deployment when several do: the highest not yanked, else the
 * highest yanked (AM-41), by SemVer precedence.
 */
function highestVersion(publications: readonly PublicationSummaryV1[]): string | undefined {
  const highest = (yanked: boolean) =>
    publications
      .filter((entry) => entry.yanked === yanked)
      .map((entry) => entry.version)
      .sort(compareVersions)
      .at(-1)
  return highest(false) ?? highest(true)
}

/**
 * The release a preview was built after, as its record declares it: only a canonical version
 * counts, as only a canonical one enters its name (AM-41).
 */
function baseVersion(record: DeploymentRecordV1 | undefined): string | undefined {
  const version = record?.commit?.base?.version
  if (version === undefined) return undefined
  try {
    return acceptVersion(version)
  } catch {
    return undefined
  }
}

/** The highest stable, non-yanked Publication strictly above `floor`. */
function availableAbove(
  publications: readonly PublicationSummaryV1[],
  floor: string,
): string | undefined {
  return publications
    .filter((entry) => !entry.yanked && !entry.version.includes('-'))
    .map((entry) => entry.version)
    .filter((version) => compareVersions(version, floor) > 0)
    .sort(compareVersions)
    .at(-1)
}

/** Whether a Publication's deployment URL is the installation's issuer: one deployment, one issuer. */
function sameIssuer(deploymentUrl: string, issuer: string): boolean {
  try {
    return issuerKey(deploymentUrl) === issuerKey(issuer)
  } catch {
    return false
  }
}

function issuerKey(input: string): string {
  const url = new URL(input)
  return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`
}

export interface InstalledListDependencies {
  /** Read the installed releases on the selected instance Kernel. */
  readonly installed: (opts: KernelCommandOpts) => Promise<{
    readonly kernel: string
    readonly releases: readonly InstalledRelease[]
  }>
  /**
   * Open the Admin registry as the caller, with the options `adminSessionOptions` keeps: never the
   * instance target, its `--creds` or `--anonymous`.
   */
  readonly registry: <Value>(
    opts: AdminConnectionOptions,
    work: (registry: AdminRegistryApi) => Promise<Value>,
  ) => Promise<Value>
  readonly record: (installation: RecordedInstallation) => Promise<DeploymentRecordV1 | undefined>
}

const defaultDependencies: InstalledListDependencies = Object.freeze({
  installed: (opts: KernelCommandOpts) =>
    withClientSession(opts, async (context: ConnectionContext) => ({
      kernel: context.target.url,
      releases: await installedReleases(context.session),
    })),
  registry: <Value>(
    opts: AdminConnectionOptions,
    work: (registry: AdminRegistryApi) => Promise<Value>,
  ) => withAdminClientSession(opts, async (context) => work(connectAdminRegistry(context))),
  record: (installation: RecordedInstallation) => readDeploymentRecord(installation),
})

/**
 * List what runs on the instance `-i`/`--url` selects. The Kernel listing comes first and decides
 * the rows; Admin is opened only when a release pin needs a version, and every deployment record
 * is read from its own dispatcher. A Kernel without the listing (before K14, such as the 1Pact Host
 * on beta.117) is refused before Admin or any deployment is contacted. A registry read that fails
 * fails the listing: versions are never silently dropped. An origin the caller cannot read in the
 * registry, or that is not registered, has no version.
 */
export async function listInstalled(
  opts: KernelCommandOpts & AdminTargetCommandOpts,
  dependencies: Partial<InstalledListDependencies> = {},
): Promise<InstalledListV1> {
  const deps = { ...defaultDependencies, ...dependencies }
  const { kernel, releases } = await deps.installed(opts)
  const origins = [...new Set(releases.map((entry) => entry.origin))]
  const [publications, records] = await Promise.all([
    origins.length === 0
      ? new Map<string, readonly PublicationSummaryV1[]>()
      : deps.registry(adminSessionOptions(opts), (registry) => readPublications(registry, origins)),
    mapBounded(releases, RECORD_READS, async (entry) => [entry, await deps.record(entry)] as const),
  ])
  const recordOf = new Map<InstalledRelease, DeploymentRecordV1 | undefined>(records)
  return Object.freeze({
    format: 'astrale.installed-list',
    version: 1,
    kernel,
    partial: true,
    domains: Object.freeze(
      releases.map((entry) =>
        describeInstalled(entry, publications.get(entry.origin) ?? [], recordOf.get(entry)),
      ),
    ),
  })
}

async function readPublications(
  registry: AdminRegistryApi,
  origins: readonly string[],
): Promise<Map<string, readonly PublicationSummaryV1[]>> {
  const indexes = await mapBounded(origins, REGISTRY_READS, async (origin) => {
    try {
      return [origin, (await registry.index(origin)).publications] as const
    } catch (error) {
      // Not registered, or not readable by this caller: the same answer, and no version.
      if (error instanceof RegistryError && error.code === 'REGISTRY_DOMAIN_NOT_FOUND')
        return [origin, []] as const
      throw error
    }
  })
  return new Map(indexes)
}

/** The human listing of Résolution [.79737]: ORIGIN, VERSION, DIGEST and AVAILABLE. */
export function installedRows(list: InstalledListV1): Array<Record<string, string>> {
  return list.domains.map((domain) => ({
    origin: domain.origin,
    version: domain.version ?? domain.name,
    digest: shortDigest(domain.pin.release),
    available: domain.available ?? '—',
  }))
}

export function renderInstalled(list: InstalledListV1): string {
  const table =
    list.domains.length === 0
      ? chalk.dim('  No installed Domain is readable by this caller.')
      : renderTable(installedRows(list), {
          showHeader: true,
          columns: [
            { key: 'origin', header: 'ORIGIN', color: chalk.cyan },
            { key: 'version', header: 'VERSION', color: chalk.bold },
            { key: 'digest', header: 'DIGEST', color: chalk.dim },
            { key: 'available', header: 'AVAILABLE' },
          ],
        })
  return `${table}\n${chalk.dim(
    '  Only installations this caller can read are listed; built-in and local Domains never are.',
  )}`
}

/** `sha256:` and the first 12 hex digits, as `astrale domain versions` prints a release. */
function shortDigest(digest: string): string {
  return `${digest.slice(0, 'sha256:'.length + 12)}…`
}
