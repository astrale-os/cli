import type {
  DomainRequest,
  InstalledPin,
  InstalledRelease,
  InstallRequest,
  InstallResult,
} from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'
import type { DomainRelease } from '@astrale-os/sdk/release'
import type { bundle } from '@astrale-os/sdk/schema'

import { ResponseError } from '@astrale-os/sdk/client'
import { parseReference } from '@astrale-os/sdk/versioning'
import chalk from 'chalk'

import type { AdminRegistryApi } from '../../admin/registry'
import type { ConnectionContext, KernelCommandOpts } from '../../connection'
import type { AdminTargetCommandOpts } from '../../lib/admin-target'
import type { InstallFailure, UrlSource } from './install-call'
import type {
  DependentProposal,
  InstallPrecheck,
  PrecheckRoot,
  PrecheckVerdict,
} from './install-precheck'
import type { ResolvedVersion, VersionReference } from './version-reference'

import { connectAdminRegistry, RegistryError, registryFailure } from '../../admin/registry'
import { withAdminClientSession, withClientSession } from '../../connection'
import { reasonCode } from '../../connection/reasons'
import { AstraleError } from '../../errors'
import {
  DeploymentReadError,
  readReleaseBundle,
  readServedDeployment,
  samePin,
  type ServedDeployment,
} from '../../lib/domain-release'
import { fatal, log } from '../../lib/log'
import { isMachine, output } from '../../lib/output'
import { exitWithInstallFailure, runInstallCall } from './install-call'
import { precheckInstall, proposeDependentVersions } from './install-precheck'
import {
  admitIssuerChanges,
  asksIssuerConsent,
  firstInstallNotice,
  issuerChangeConsent,
  issuerConsentRequest,
  plannedIssuerChange,
  type IssuerChange,
  type IssuerChangeConsent,
  type IssuerConsentRequest,
} from './issuer-consent'
import { consentToDeclaredOrigin, warnUnconfirmedOverride } from './legacy/identity-override'
import { installPublications } from './legacy/publication-install'
import { acceptDomainOperationId, createDomainOperationId } from './operation'
import {
  admitVersionReference,
  exactReference,
  isVersionReference,
  refuseRepeatedOrigins,
  resolveVersionReferences,
} from './version-reference'

/**
 * How long the CLI's read of a deployment that answers 503 (not serving yet) is retried. Only that
 * read is retried: the Kernel refuses its own failed read as SCHEMA_BACKEND_FAILED with empty
 * details, the code it also gives backend failures, so a refused install is never sent again
 * (AM-97).
 */
export const NOT_YET_ACTIVE_WINDOW_MS = 60_000

export type ReferenceInstallOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    readonly operation?: string
    readonly token?: string
    readonly allowIdentityOverride?: boolean
    /** Every `--allow-issuer-change` occurrence: `''` without an origin, else the origin it names. */
    readonly allowIssuerChange?: readonly string[]
    readonly revokePrevious?: boolean
    // Programmatic opt-out for callers that drive the install as a function; the CLI flags are read
    // from argv by `canPrompt`.
    readonly ci?: boolean
    readonly noPrompt?: boolean
  }

/** The pin, revision and issuer of one installation, as the installed listing reports them. */
export interface InstalledState {
  readonly revision: string
  readonly pin: InstalledPin
  readonly issuer: string
}

/**
 * The issuer consent one reference's root carried (CT24): the installed issuer it replaced, the
 * issuer that replaced it, and what happens to the replaced one (the Kernel default, `drain`, or
 * `revoke` with --revoke-previous).
 */
export interface ReferenceConsent {
  readonly from: string
  readonly to: string
  readonly previous: 'drain' | 'revoke'
}

/**
 * What one reference installed: the reference as written, the deployment URL it names (for
 * a version, the URL its Publication names), the pin the install expected, the installation
 * before and after as the caller can read it (null when absent or not readable), and the issuer
 * consent its root carried, present only when the install changed its issuer. The expected pin of
 * a version is the release its Publication names; for a URL it is the pin read from what the URL
 * serves before the install, null when the CLI could not read it. A version reference also names
 * the version it resolved to, and carries `yanked: true` when that version is yanked, which only an
 * exact reference installs ([.79339]); a URL reference carries neither.
 */
export interface InstallReference {
  readonly reference: string
  readonly origin: string | null
  readonly url: string
  readonly version?: string
  readonly yanked?: true
  readonly pin: InstalledPin | null
  readonly previous: InstalledState | null
  readonly installed: InstalledState | null
  readonly consent?: ReferenceConsent
}

/** A Kernel refusal of a request whose install had already committed (AM-81). */
export type CommittedInstallRefusal = 'SCHEMA_INPUT_INVALID' | 'SCHEMA_OPERATION_CONFLICT'

/**
 * `--json` of an install: the Kernel result, unchanged, plus one entry per reference. When the
 * Kernel refused the request but every reference is already installed as requested (AM-81), the
 * result is `{ changed: false, domains }` read back from the Kernel and `recovered` names the
 * refusal, so a consumer can tell it from a Kernel replay.
 */
export type InstallReport = InstallResult & {
  readonly references: readonly InstallReference[]
  readonly recovered?: { readonly refusal: CommittedInstallRefusal }
  /** The advisory pre-check this install ran before it was sent ([.78239] [.69634]). */
  readonly precheck: InstallPrecheck
}

export interface ReferenceInstallDependencies {
  readonly acceptOperationId: (input: unknown) => string
  readonly createOperationId: () => string
  readonly withClientSession: typeof withClientSession
  /** Opens the Admin registry with the caller's own credential; only version references do. */
  readonly openRegistry: <Value>(
    opts: ReferenceInstallOpts,
    work: (registry: Pick<AdminRegistryApi, 'index'>) => Promise<Value>,
  ) => Promise<Value>
  readonly readDeployment: (url: string, signal?: AbortSignal) => Promise<ServedDeployment>
  /** Reads the Schema Bundle a served release names, for the pre-check. */
  readonly readBundle: (
    release: DomainRelease,
    url: string,
    signal?: AbortSignal,
  ) => Promise<bundle.Bundle>
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}

const defaultDependencies: ReferenceInstallDependencies = Object.freeze({
  acceptOperationId: (input: unknown) => acceptDomainOperationId(input, 'install'),
  createOperationId: () => createDomainOperationId('install'),
  withClientSession,
  openRegistry: openInstallRegistry,
  readDeployment: (url: string, signal?: AbortSignal) => readServedDeployment(url, signal),
  readBundle: (release: DomainRelease, url: string, signal?: AbortSignal) =>
    readReleaseBundle(release, url, signal),
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
})

/**
 * One root of an install: the reference as the operator wrote it, the deployment URL it names and
 * the host serving it. A version reference also carries the Publication it resolved to, whose
 * release the Kernel must find at that URL.
 */
export interface ReleaseSource extends UrlSource {
  readonly reference: string
  readonly publication?: ResolvedVersion
}

/**
 * Install every reference in one atomic Kernel operation on the instance Kernel. The syntax
 * decides ([.78896]): a deployment URL is installed as is, without any lookup; a version
 * reference (`<origin>@<major>.<minor>.<patch>[-<pre>]` or `<origin>@<major>.<minor>`) is first
 * translated, once, into the deployment URL and release of one Publication the caller may read in
 * Admin (Résolution [.78020] [.78086]). An Admin that cannot answer fails the version references
 * only, before any Kernel is contacted. An install of URLs alone reads Admin only to propose a
 * compatible version of an installed dependent the pre-check finds broken ([.69634]).
 *
 * A Kernel that lists installed releases receives the `release` request, guarded by the release
 * digest each root must serve (the Publication's for a version, the one read from the URL
 * otherwise; [.78352]) and carrying the operator's consent for each root whose issuer it changes
 * (D7). A Kernel without that listing receives the pre-release `publication` request
 * (`legacy/publication-install.ts`) and takes neither issuer consent nor a version reference.
 */
export async function installByReference(
  references: readonly [string, ...string[]],
  opts: ReferenceInstallOpts,
  dependencies: Partial<ReferenceInstallDependencies> = {},
): Promise<void> {
  const deps = { ...defaultDependencies, ...dependencies }
  let written: readonly WrittenReference[]
  let versions: readonly VersionReference[]
  let operation: string
  let consent: IssuerChangeConsent
  try {
    consent = issuerChangeConsent(opts.allowIssuerChange, opts.revokePrevious)
    written = references.map(admitWrittenReference)
    versions = written.flatMap((entry) => (entry.kind === 'version' ? [entry.version] : []))
    refuseRepeatedUrls(written.flatMap((entry) => (entry.kind === 'url' ? [entry.source.url] : [])))
    refuseRepeatedOrigins(versions)
    if (opts.token !== undefined && (written.length > 1 || written[0]!.kind !== 'url')) {
      throw new AstraleError(
        'INVALID_FLAG',
        '--token is valid only with a single URL reference.',
        'A delivery token is sent to one deployment; install private Domains one at a time.',
      )
    }
    operation =
      opts.operation === undefined
        ? deps.createOperationId()
        : deps.acceptOperationId(opts.operation)
  } catch (error) {
    fatal(error, opts)
  }

  let resolved: readonly ResolvedVersion[] = []
  if (versions.length > 0) {
    try {
      resolved = await deps.openRegistry(opts, (registry) =>
        resolveVersionReferences(versions, registry),
      )
    } catch (error) {
      fatal(registryFailure(error, 'read'), opts)
    }
  }
  let sources: readonly [ReleaseSource, ...ReleaseSource[]]
  try {
    sources = releaseSources(written, resolved)
    refuseRepeatedUrls(sources.map((source) => source.url))
  } catch (error) {
    fatal(error, opts)
  }
  if (!isMachine(opts)) {
    for (const version of resolved) {
      if (version.yanked) {
        log.warn(
          `${version.origin} ${version.version} is yanked: it is installed only because ${version.reference} names it exactly.`,
        )
      }
    }
  }

  let failure: InstallFailure | undefined
  try {
    failure = await deps.withClientSession(
      opts,
      async (context) => {
        const before = await installedReleases(context.session)
        if (before === undefined) {
          if (resolved.length > 0) return { error: versionsUnsupported(), render: 'input' }
          if (asksIssuerConsent(consent)) return { error: consentUnsupported(), render: 'input' }
          return installPublications(context, sources, operation, opts)
        }
        return installReleases(context, sources, before, operation, consent, opts, deps)
      },
      { principal: 'caller' },
    )
  } catch (error) {
    failure = { error, render: 'kernel' }
  }
  if (failure !== undefined) await exitWithInstallFailure(failure, opts)
}

/** One reference as written: a deployment URL, or a version the registry resolves. */
type WrittenReference =
  | { readonly kind: 'url'; readonly source: ReleaseSource }
  | { readonly kind: 'version'; readonly version: VersionReference }

/**
 * A version reference names an origin and a version (`<origin>@<version>`); any other reference
 * reaching this route names one deployment, refused here when it is not an http(s) URL.
 */
function admitWrittenReference(reference: string): WrittenReference {
  if (isVersionReference(reference)) {
    return Object.freeze({ kind: 'version', version: admitVersionReference(reference) })
  }
  return Object.freeze({
    kind: 'url',
    source: Object.freeze({ reference, url: reference, host: validateInstallUrl(reference) }),
  })
}

/** The sources in reference order, each version replaced by its Publication's deployment. */
function releaseSources(
  written: readonly WrittenReference[],
  resolved: readonly ResolvedVersion[],
): readonly [ReleaseSource, ...ReleaseSource[]] {
  let next = 0
  return Object.freeze(
    written.map((entry): ReleaseSource => {
      if (entry.kind === 'url') return entry.source
      const publication = resolved[next++]!
      return Object.freeze({
        reference: publication.reference,
        url: publication.url,
        host: validateInstallUrl(publication.url),
        publication,
      })
    }),
  ) as unknown as readonly [ReleaseSource, ...ReleaseSource[]]
}

/**
 * The Admin registry of the configured Admin target (`--admin`, `--admin-url`, or the CLI
 * configuration), read with the caller's own identity ([.79495]): never the install target that
 * `-i`/`--url` select, and never `--creds`, the raw credential of that target. `open` is the
 * Admin session seam the tests stub.
 */
export function openInstallRegistry<Value>(
  opts: ReferenceInstallOpts,
  work: (registry: Pick<AdminRegistryApi, 'index'>) => Promise<Value>,
  open: typeof withAdminClientSession = withAdminClientSession,
): Promise<Value> {
  return open(
    {
      ...(opts.admin === undefined ? {} : { admin: opts.admin }),
      ...(opts.adminUrl === undefined ? {} : { adminUrl: opts.adminUrl }),
      ...(opts.domainIssuer === undefined ? {} : { domainIssuer: opts.domainIssuer }),
      ...(opts.timeout === undefined ? {} : { timeout: opts.timeout }),
      ...(opts.as === undefined ? {} : { as: opts.as }),
      ...(opts.ci === undefined ? {} : { ci: opts.ci }),
    },
    async (context) => work(connectAdminRegistry(context)),
  )
}

/**
 * The installed releases the caller can read, or `undefined` from a Kernel that predates the
 * listing: such a Kernel refuses the `installed` kind as invalid input, which a Kernel that has
 * the listing never does.
 */
export async function installedReleases(
  session: ClientSession,
): Promise<readonly InstalledRelease[] | undefined> {
  try {
    return await session.schema.installed()
  } catch (error) {
    if (error instanceof ResponseError && reasonCode(error.reason) === 'FUNCTION_INPUT_INVALID') {
      return undefined
    }
    throw error
  }
}

/**
 * One `release` source per reference, guarded by the release digest the reference must serve when
 * one is expected, and carrying the issuer consent of a root whose issuer the install changes.
 */
export function releaseInstallInput(
  urls: readonly [string, ...string[]],
  expected: readonly (InstalledPin | null)[],
  operation: string,
  token?: string,
  consents: readonly (IssuerConsentRequest | undefined)[] = [],
): InstallRequest {
  const domains = urls.map((url, index): DomainRequest => {
    const pin = expected[index]
    const consent = consents[index]
    return Object.freeze({
      release: Object.freeze({
        url,
        ...(token === undefined ? {} : { token }),
        ...(pin?.kind === 'release' ? { digest: pin.release } : {}),
      }),
      ...(consent === undefined ? {} : { consent }),
    })
  })
  return Object.freeze({
    operation: operation as InstallRequest['operation'],
    domains: Object.freeze(domains) as unknown as InstallRequest['domains'],
  })
}

/**
 * What the CLI knows of one root before the install: its origin (named by its version reference,
 * else read from what its URL serves) and the pin the install expects.
 */
interface PlannedRoot {
  readonly source: ReleaseSource
  readonly served: ServedDeployment | undefined
  readonly origin: string | undefined
  readonly expected: InstalledPin | null
}

function plannedRoots(
  sources: readonly ReleaseSource[],
  served: readonly (ServedDeployment | undefined)[],
): readonly PlannedRoot[] {
  return sources.map((source, index) => {
    const deployment = served[index]
    return Object.freeze({
      source,
      served: deployment,
      origin: source.publication?.origin ?? deployment?.origin,
      expected: source.publication?.pin ?? deployment?.pin ?? null,
    })
  })
}

/** Join what each root expected with the installed listings read before and after. */
export function installReferences(
  roots: readonly PlannedRoot[],
  before: readonly InstalledRelease[],
  after: readonly InstalledRelease[] | undefined,
  changes: readonly (IssuerChange | undefined)[] = [],
  consent: IssuerChangeConsent | undefined = undefined,
): readonly InstallReference[] {
  return roots.map(({ source, origin: planned, expected }, index) => {
    const change = changes[index]
    const url = new URL(source.url).origin
    const origin = planned ?? after?.find((installed) => installed.url === url)?.origin ?? null
    const state = (listing: readonly InstalledRelease[] | undefined): InstalledState | null => {
      const installed =
        origin === null ? undefined : listing?.find((entry) => entry.origin === origin)
      return installed === undefined
        ? null
        : Object.freeze({
            revision: installed.revision,
            pin: installed.pin,
            issuer: installed.issuer,
          })
    }
    const publication = source.publication
    return Object.freeze({
      reference: source.reference,
      origin,
      url: source.url,
      ...(publication === undefined ? {} : { version: publication.version }),
      ...(publication?.yanked === true ? { yanked: true as const } : {}),
      pin: expected,
      previous: state(before),
      installed: state(after),
      ...(change === undefined
        ? {}
        : {
            consent: Object.freeze({
              from: change.from,
              to: change.to,
              previous: consent?.revokePrevious === true ? ('revoke' as const) : ('drain' as const),
            }),
          }),
    })
  })
}

/**
 * References whose installation does not pin what the install expected: another document, or the
 * same origin installed from another deployment.
 */
export function pinMismatches(
  references: readonly InstallReference[],
  after: readonly InstalledRelease[] | undefined,
): readonly InstallReference[] {
  return references.filter((reference) => {
    if (reference.pin === null || reference.origin === null) return false
    const installed = after?.find((entry) => entry.origin === reference.origin)
    if (installed === undefined) return false
    return !samePin(reference.pin, installed.pin) || installed.url !== new URL(reference.url).origin
  })
}

async function installReleases(
  context: ConnectionContext,
  sources: readonly [ReleaseSource, ...ReleaseSource[]],
  before: readonly InstalledRelease[],
  operation: string,
  consent: IssuerChangeConsent,
  opts: ReferenceInstallOpts,
  deps: ReferenceInstallDependencies,
): Promise<InstallFailure | undefined> {
  const machine = isMachine(opts)
  const urls = sources.map((source) => source.url) as [string, ...string[]]
  const retry = notYetActiveWindow(deps)
  let roots: readonly PlannedRoot[]
  let changes: readonly (IssuerChange | undefined)[]
  const overridden: (string | undefined)[] = []
  try {
    for (const url of urls) admitReference(url)
    const served = await Promise.all(
      sources.map((source) => readWithRetry(source, retry, deps, machine)),
    )
    // The served release is checked before anything is sent; the Kernel checks it again.
    refuseReleaseMismatches(sources, served)
    roots = plannedRoots(sources, served)
    refuseDuplicateOrigins(roots)
    refuseUnknownConsentOrigins(consent, roots)
    changes = roots.map(({ source, served: deployment }) =>
      deployment === undefined ? undefined : plannedIssuerChange(source.url, deployment, before),
    )
    for (const [index, { source, served: deployment }] of roots.entries()) {
      // The identity-override gate stays for a source that serves only domain.json (legacy).
      overridden.push(
        deployment?.pin.kind === 'legacy'
          ? await consentToDeclaredOrigin(
              deployment.origin,
              source.host,
              opts.allowIdentityOverride ?? false,
              machine,
            )
          : undefined,
      )
      // A version names its deployment through Admin's registry, so only a URL claims an origin.
      if (
        source.publication === undefined &&
        changes[index] === undefined &&
        deployment !== undefined &&
        !machine &&
        !installedOrigin(before, deployment.origin)
      ) {
        const notice = firstInstallNotice(deployment, source.url)
        if (notice !== undefined) log.warn(notice)
      }
    }
  } catch (error) {
    return { error, render: 'input' }
  }
  // The pre-check informs the operator's issuer consent, so it is shown before that prompt.
  // Advisory: a defect anywhere in it reports every root failed and the install is still sent.
  const precheck = await precheckReferences(context.session, roots, before, opts, deps, {
    changes,
    overridden,
  }).catch(() => failedPrecheck(roots))
  if (!machine) presentPrecheck(precheck)
  try {
    await admitIssuerChanges(
      changes.filter((change): change is IssuerChange => change !== undefined),
      consent,
      machine,
      opts,
    )
  } catch (error) {
    return { error, render: 'input' }
  }
  if (!machine) warnUnreadableConsentOrigins(consent, roots, before)
  if (!machine && consent.revokePrevious && changes.every((change) => change === undefined)) {
    log.dim('  --revoke-previous: no installed issuer changes, so there is nothing to revoke.')
  }

  const request = releaseInstallInput(
    urls,
    roots.map((root) => root.expected),
    operation,
    opts.token,
    changes.map((change) =>
      change === undefined ? undefined : issuerConsentRequest(change, consent),
    ),
  )
  let mismatched: readonly InstallReference[] = []
  const failure = await runInstallCall<InstallOutcome>(opts, {
    label:
      sources.length === 1
        ? `Installing domain from ${sources[0].reference} (operation ${operation})`
        : `Installing ${sources.length} domains (operation ${operation})`,
    recovery: {
      operation,
      retry: releaseInstallRetry(sources, operation, opts, changes, overridden),
    },
    call: async () => {
      try {
        const result = await context.session.schema.install(request)
        return { result, after: await installedAfter(context.session, machine) }
      } catch (error) {
        const recovered = await recoverCommittedInstall(error, context.session, roots)
        if (recovered !== undefined) return recovered
        throw error
      }
    },
    format: ({ result, after, recovered }, raw) => {
      const report = installReferences(
        roots,
        before,
        after,
        recovered === undefined ? changes : [],
        consent,
      )
      mismatched = pinMismatches(report, after)
      if (raw) {
        output(
          {
            ...result,
            references: report,
            ...(recovered === undefined ? {} : { recovered }),
            precheck,
          } satisfies InstallReport,
          opts,
        )
        return
      }
      presentReferences(report, operation, result)
      if (recovered !== undefined) {
        log.dim(
          `  The Kernel refused this install (${recovered.refusal}), but every Domain is installed as requested: an earlier install already committed it.`,
        )
      }
      for (const [index, reference] of report.entries()) {
        if (reference.consent !== undefined) {
          log.dim(
            `  ${reference.origin}: issuer ${reference.consent.from} -> ${reference.consent.to} ` +
              `(${changes[index]?.line === 'same' ? 'same line' : 'another line'}; ` +
              `the previous issuer ${reference.consent.previous === 'revoke' ? 'is revoked' : 'drains'})`,
          )
        }
      }
      for (const [index, reference] of report.entries()) {
        const pin = reference.pin ?? reference.installed?.pin
        if (reference.origin !== null && pin?.kind === 'legacy') {
          warnUnconfirmedOverride(
            reference.origin,
            sources[index]!.host,
            overridden[index],
            machine,
          )
        }
        if (reference.installed === null && after !== undefined) {
          log.warn(
            `The installation of ${reference.origin ?? reference.reference} is not readable by this identity; its pin was not verified.`,
          )
        }
      }
    },
  })
  if (failure !== undefined)
    return compatibilityRefusal(failure) ? { ...failure, precheck } : failure
  if (mismatched.length > 0) return { error: pinMismatchError(mismatched), render: 'input' }
  return undefined
}

/** Whether the pre-check predicted a refusal. */
function predicted(precheck: InstallPrecheck): boolean {
  return precheck.dependencies.length > 0 || precheck.dependents.length > 0
}

/** The Kernel refusals the pre-check predicts. */
const COMPATIBILITY_REFUSALS: ReadonlySet<string> = new Set([
  'SCHEMA_DEPENDENCY_INCOMPATIBLE',
  'SCHEMA_DEPENDENTS_INCOMPATIBLE',
])

/**
 * Whether the install failed on a Kernel refusal of the kind the pre-check predicts: only then is
 * the pre-check shown beside the refusal. A transport failure or an unknown outcome is resent with
 * its own operation id, never replaced by the proposed install.
 */
function compatibilityRefusal(failure: InstallFailure): boolean {
  return (
    failure.render === 'kernel' &&
    failure.error instanceof ResponseError &&
    COMPATIBILITY_REFUSALS.has(reasonCode(failure.error.reason) ?? '')
  )
}

/**
 * Run the advisory pre-check of one install ([.78239] [.69634]) and, for each broken dependent,
 * read the registry for a compatible version to propose. Only a broken dependent opens the
 * registry, so an install of URLs that the pre-check passes never reads Admin. Nothing here fails
 * the install: what the CLI cannot read is reported as skipped or unevaluated, and the install is
 * sent for the Kernel to decide.
 */
async function precheckReferences(
  session: ClientSession,
  roots: readonly PlannedRoot[],
  before: readonly InstalledRelease[],
  opts: ReferenceInstallOpts,
  deps: ReferenceInstallDependencies,
  retry: {
    readonly changes: readonly (IssuerChange | undefined)[]
    readonly overridden: readonly (string | undefined)[]
  },
): Promise<InstallPrecheck> {
  const checked = await Promise.all(
    roots.map(async ({ source, served, origin }): Promise<PrecheckRoot> => {
      const skip = (reason: Extract<PrecheckRoot, { kind: 'skipped' }>['reason']): PrecheckRoot =>
        Object.freeze({
          kind: 'skipped' as const,
          reference: source.reference,
          ...(origin === undefined ? {} : { origin }),
          ...(served === undefined ? {} : { revision: served.revision }),
          reason,
        })
      if (served === undefined) return skip('release-unread')
      if (served.release === undefined) {
        return skip(served.pin.kind === 'legacy' ? 'legacy' : 'release-unread')
      }
      try {
        const bundle = await deps.readBundle(
          served.release,
          source.url,
          AbortSignal.timeout(10_000),
        )
        return Object.freeze({
          kind: 'release' as const,
          reference: source.reference,
          origin: served.origin,
          release: served.release,
          bundle,
        })
      } catch {
        return skip('bundle-unread')
      }
    }),
  )
  let evaluated: PrecheckVerdict
  try {
    evaluated = await precheckInstall(checked, before, session.schema)
  } catch {
    // Advisory: a defect of the pre-check never stops an install the Kernel would admit.
    return failedPrecheck(roots)
  }
  const { indirect, ...verdict } = evaluated
  if (verdict.dependents.length === 0) return Object.freeze({ ...verdict, proposals: [] })
  // A dependent that breaks on a dependency it reaches only through another Domain has no answer
  // in the registry, so only the others open it.
  const direct = verdict.dependents.filter(({ domain }) => !indirect.has(domain.origin))
  let registered: readonly DependentProposal[] = []
  if (direct.length > 0) {
    try {
      registered = await deps.openRegistry(opts, (registry) =>
        proposeDependentVersions(direct, before, registry),
      )
    } catch (error) {
      const { code } = registryFailure(error, 'read')
      registered = [...new Set(direct.map(({ domain }) => domain.origin))].map((origin) =>
        Object.freeze({ origin, kind: 'unread' as const, code }),
      )
    }
  }
  const proposals = [...new Set(verdict.dependents.map(({ domain }) => domain.origin))].map(
    (origin): DependentProposal => {
      const through = indirect.get(origin)
      return through === undefined
        ? registered.find((proposal) => proposal.origin === origin)!
        : Object.freeze({ origin, kind: 'indirect' as const, dependencies: Object.freeze(through) })
    },
  )
  const versions = proposals.flatMap((proposal) =>
    proposal.kind === 'version' ? [`${proposal.origin}@${proposal.version}`] : [],
  )
  const command =
    versions.length === proposals.length
      ? installCommand(
          [...roots.map(({ source }) => installedReference(source)), ...versions],
          opts,
          retry.changes,
          retry.overridden,
          { registry: true },
        )
      : undefined
  return Object.freeze({
    ...verdict,
    proposals,
    ...(command === undefined ? {} : { command }),
  })
}

/** The pre-check of an install it could not run: every root is reported failed, nothing predicted. */
function failedPrecheck(roots: readonly PlannedRoot[]): InstallPrecheck {
  return Object.freeze({
    compared: 0,
    dependencies: [],
    dependents: [],
    skipped: roots.map(({ source }) =>
      Object.freeze({ reference: source.reference, reason: 'failed' as const }),
    ),
    unevaluated: [],
    proposals: [],
  })
}

/**
 * The pre-check for a human, before the install is sent: what the engine predicts the Kernel will
 * refuse, the grouped install that would pass, and what it could not evaluate.
 */
function presentPrecheck(precheck: InstallPrecheck): void {
  for (const finding of precheck.dependencies) {
    log.warn(
      `Pre-check: ${finding.origin} was built against ${finding.dependency} ${shortDigest(finding.expected)}, ` +
        `which ${shortDigest(finding.actual)} changes: ${changesLabel(finding.changes)}.`,
    )
  }
  for (const finding of precheck.dependents) {
    log.warn(
      `Pre-check: installing ${finding.dependency} ${shortDigest(finding.actual)} breaks installed ` +
        `${finding.domain.origin}, built against ${shortDigest(finding.expected)}: ${changesLabel(finding.changes)}.`,
    )
  }
  for (const proposal of precheck.proposals) {
    if (proposal.kind === 'none') {
      // The registry lists each Publication's exact dependency revisions; a version built against
      // others may still hold, and the Kernel decides.
      log.warn(
        `  No published version of ${proposal.origin} is built against the revisions this install brings.`,
      )
    } else if (proposal.kind === 'indirect') {
      log.warn(
        `  No version of ${proposal.origin} is proposed: it reaches ${proposal.dependencies.join(', ')} only through another Domain, and Publications list their direct dependencies only.`,
      )
    } else if (proposal.kind === 'unread') {
      log.dim(
        `  ${proposal.origin}: the registry could not be read (${proposal.code}), so no version is proposed.`,
      )
    } else if (proposal.issuer !== undefined) {
      log.dim(
        `  ${proposal.origin}@${proposal.version} changes its issuer (${proposal.issuer.from} -> ${proposal.issuer.to}): the install asks for that consent, or name it with --allow-issuer-change=${proposal.origin}.`,
      )
    }
  }
  if (precheck.command !== undefined) log.info(`  Proposed grouped install: ${precheck.command}`)
  for (const { reference, reason } of precheck.skipped) {
    log.dim(`  Pre-check skipped ${reference}: ${SKIPPED[reason]}`)
  }
  if (precheck.unevaluated.length > 0) {
    const count = precheck.unevaluated.length
    log.dim(
      `  Pre-check could not evaluate ${count === 1 ? '1 Domain' : `${count} Domains`} (${precheck.unevaluated.join(', ')}): ` +
        `${count === 1 ? 'its' : 'their'} installed schema or bindings are not readable here, or the engine could not compare them.`,
    )
  }
  if (predicted(precheck)) {
    log.dim('  The pre-check is advisory: the install is sent and the Kernel decides.')
  } else if (precheck.compared > 0) {
    log.dim(
      `  Pre-check: ${precheck.compared} dependency ${precheck.compared === 1 ? 'binding holds' : 'bindings hold'}; the Kernel checks again.`,
    )
  }
}

const SKIPPED: Readonly<Record<InstallPrecheck['skipped'][number]['reason'], string>> = {
  'release-unread': 'what its deployment serves could not be read.',
  legacy: 'it serves a legacy v2/v3 document.',
  'bundle-unread': 'the Schema Bundle its release names could not be read.',
  failed: 'the pre-check failed; the Kernel still checks the install.',
}

function changesLabel(changes: InstallPrecheck['dependencies'][number]['changes']): string {
  const shown = changes.slice(0, 3).map(({ key, kind }) => `${key} ${kind}`)
  return changes.length > 3
    ? `${shown.join(', ')} and ${changes.length - 3} more`
    : shown.join(', ')
}

/** What the install call gives the presentation: the Kernel result and the listing read after it. */
interface InstallOutcome {
  readonly result: InstallResult
  readonly after: readonly InstalledRelease[] | undefined
  /** Present when the Kernel refused a request whose install had already committed (AM-81). */
  readonly recovered?: { readonly refusal: CommittedInstallRefusal }
}

function installedOrigin(installed: readonly InstalledRelease[], origin: string): boolean {
  return installed.some((entry) => entry.origin === origin)
}

/**
 * A version is installed only from a deployment that serves the release its Publication names
 * ([.78352]): a deployment the CLI reads serving another release, or only the legacy domain.json,
 * is refused before anything is sent. A deployment the CLI cannot read is left to the Kernel,
 * which receives the Publication's release digest and refuses any other release.
 */
function refuseReleaseMismatches(
  sources: readonly ReleaseSource[],
  served: readonly (ServedDeployment | undefined)[],
): void {
  for (const [index, source] of sources.entries()) {
    const publication = source.publication
    const deployment = served[index]
    if (publication === undefined || deployment === undefined) continue
    if (deployment.pin.kind === 'release' && deployment.pin.release === publication.pin.release) {
      continue
    }
    throw new RegistryError(
      'PUBLICATION_RELEASE_MISMATCH',
      `${publication.url} no longer serves the release ${publication.origin} ${publication.version} names (${publication.pin.release}); nothing was installed.`,
      {
        origin: publication.origin,
        version: publication.version,
        url: publication.url,
        expected: publication.pin.release,
        served: deployment.pin.kind === 'release' ? deployment.pin.release : null,
      },
    )
  }
}

/**
 * An origin named by `--allow-issuer-change=<origin>` must be one this install names; a typo would
 * otherwise consent to nothing. A root whose origin is unknown (an unreadable URL) leaves the
 * check open.
 */
function refuseUnknownConsentOrigins(
  consent: IssuerChangeConsent,
  roots: readonly PlannedRoot[],
): void {
  if (roots.some((root) => root.origin === undefined)) return
  const origins = roots.map((root) => root.origin!)
  for (const origin of consent.origins) {
    if (!origins.includes(origin)) {
      throw new AstraleError(
        'INVALID_FLAG',
        `--allow-issuer-change=${origin} names no Domain of this install.`,
        `The references serve ${origins.join(', ')}.`,
      )
    }
  }
}

/**
 * An origin named by `--allow-issuer-change=<origin>` that this install names but whose
 * installation the caller cannot read gets no consent: the CLI plans consents from the installed
 * listing only and never builds one from a Kernel refusal. Either the origin is not installed (a
 * first install needs no consent) or the listing hides it; the operator is told before the send.
 */
function warnUnreadableConsentOrigins(
  consent: IssuerChangeConsent,
  roots: readonly PlannedRoot[],
  before: readonly InstalledRelease[],
): void {
  for (const origin of consent.origins) {
    const named = roots.some((root) => root.origin === origin)
    if (!named || installedOrigin(before, origin)) continue
    log.warn(
      `--allow-issuer-change=${origin}: ${origin} is not among the installations this identity can read, so no consent is sent. ` +
        'If it is installed, consenting to its issuer change needs read access to its installation.',
    )
  }
}

/**
 * AM-81: an issuer consent sent after its install committed is refused, under a new operation id as
 * SCHEMA_INPUT_INVALID at `/domains/<i>/consent` (the Domain no longer changes issuer), under the
 * same id as SCHEMA_OPERATION_CONFLICT (a retry planned from the moved listing carries no consent).
 * Before such a refusal is reported, the installations are read back: when every reference is
 * installed from its URL with the pin the install expected, the install asked for holds, and the
 * command reports it as already current with the installed Domains as the Kernel describes them,
 * marked `recovered` with the Kernel refusal it recovered from.
 */
async function recoverCommittedInstall(
  error: unknown,
  session: ClientSession,
  roots: readonly PlannedRoot[],
): Promise<InstallOutcome | undefined> {
  const refusal = committedConsentRefusal(error)
  if (refusal === undefined) return undefined
  let after: readonly InstalledRelease[]
  try {
    after = await session.schema.installed()
  } catch {
    return undefined
  }
  const origins: string[] = []
  for (const { source, origin, expected } of roots) {
    const installed = after.find((entry) => entry.origin === origin)
    if (
      origin === undefined ||
      expected === null ||
      installed === undefined ||
      !samePin(expected, installed.pin) ||
      installed.url !== new URL(source.url).origin
    ) {
      return undefined
    }
    origins.push(origin)
  }
  let domains: CurrentDomains
  try {
    domains = (await Promise.all(
      origins.map((origin) => session.schema.inspect(origin as never)),
    )) as unknown as CurrentDomains
  } catch {
    return undefined
  }
  return Object.freeze({
    result: Object.freeze({ changed: false, domains }) as InstallResult,
    after,
    recovered: Object.freeze({ refusal }),
  })
}

type CurrentDomains = Extract<InstallResult, { readonly changed: false }>['domains']

function committedConsentRefusal(error: unknown): CommittedInstallRefusal | undefined {
  if (!(error instanceof ResponseError)) return undefined
  const code = reasonCode(error.reason)
  if (code === 'SCHEMA_OPERATION_CONFLICT') return code
  if (code !== 'SCHEMA_INPUT_INVALID') return undefined
  const details = (error.reason as { readonly details?: { readonly path?: unknown } }).details
  return typeof details?.path === 'string' && /^\/domains\/\d+\/consent$/u.test(details.path)
    ? code
    : undefined
}

function consentUnsupported(): AstraleError {
  return new AstraleError(
    'KERNEL_RELEASE_UNSUPPORTED',
    'This Kernel does not list installed releases, so it takes no issuer consent: --allow-issuer-change and --revoke-previous are refused before any install.',
    'Install without them: on this Kernel the identity-override gate (--allow-identity-override) still applies. Issuer consent needs a Host release whose Kernel lists installed releases and accepts consents.',
  )
}

/**
 * A version is installed with the release digest its Publication names, which only the `release`
 * request carries: a Kernel without the installed listing takes the `publication` request, which
 * pins whatever the URL serves, so a version reference is refused there before any install.
 */
function versionsUnsupported(): AstraleError {
  return new AstraleError(
    'KERNEL_RELEASE_UNSUPPORTED',
    'This Kernel does not list installed releases, so it cannot pin a published version: version references (<origin>@<version>) are refused before any install.',
    'Install the deployment URL instead (`astrale domain versions <origin> --json` names it), or upgrade the Host to a release whose Kernel lists installed releases.',
  )
}

/**
 * The deadline shared by the reads of every reference that is not serving yet: it opens at the
 * first 503 and closes {@link NOT_YET_ACTIVE_WINDOW_MS} later.
 */
interface RetryWindow {
  /** Wait before the next attempt; false once the window is spent. */
  wait(retryAfterMs: number | undefined, attempt: number): Promise<boolean>
}

function notYetActiveWindow(
  deps: Pick<ReferenceInstallDependencies, 'now' | 'sleep'>,
): RetryWindow {
  let deadline: number | undefined
  return {
    async wait(retryAfterMs, attempt) {
      const now = deps.now()
      deadline ??= now + NOT_YET_ACTIVE_WINDOW_MS
      const remaining = deadline - now
      if (remaining <= 0) return false
      const backoff = Math.min(1_000 * 2 ** Math.min(attempt, 4), 10_000)
      await deps.sleep(Math.min(retryAfterMs ?? backoff, remaining))
      return true
    },
  }
}

async function readWithRetry(
  source: ReleaseSource,
  retry: RetryWindow,
  deps: ReferenceInstallDependencies,
  machine: boolean,
): Promise<ServedDeployment | undefined> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await deps.readDeployment(source.url, AbortSignal.timeout(10_000))
    } catch (error) {
      if (
        error instanceof DeploymentReadError &&
        error.retryable &&
        (await retry.wait(error.retryAfterMs, attempt))
      ) {
        continue
      }
      // The CLI only reads what the URL serves to guard and report the install; the Kernel reads it
      // again and stays the authority, so an unreadable document is installed without a digest
      // read from it: a version still carries the one its Publication names.
      if (!machine) {
        log.warn(
          `Could not read what ${source.url} serves (${error instanceof Error ? error.message : 'unreadable'}) — ` +
            (source.publication === undefined
              ? 'installing it without an expected release digest; the installed pin is reported after install.'
              : `installing it with the release digest ${source.publication.origin} ${source.publication.version} names; the Kernel refuses any other release.`),
        )
      }
      return undefined
    }
  }
}

async function installedAfter(
  session: ClientSession,
  machine: boolean,
): Promise<readonly InstalledRelease[] | undefined> {
  try {
    return await session.schema.installed()
  } catch (error) {
    if (!machine) {
      log.warn(
        `Installed, but the installed releases could not be read back (${error instanceof Error ? error.message : 'unknown failure'}); the pins were not verified.`,
      )
    }
    return undefined
  }
}

function admitReference(reference: string): void {
  try {
    parseReference(reference)
  } catch (cause) {
    throw new AstraleError(
      'INVALID_DOMAIN_URL',
      cause instanceof Error ? cause.message : `Reference ${reference} is not admitted.`,
      'Write the deployment URL as the Kernel reads it, for example https://crm.acme.dev',
      { cause },
    )
  }
}

function refuseRepeatedUrls(references: readonly string[]): void {
  const seen = new Set<string>()
  for (const reference of references) {
    const url = new URL(reference).origin
    if (seen.has(url)) {
      throw new AstraleError(
        'DUPLICATE_ORIGIN',
        `The deployment ${url} is named more than once.`,
        'Name each Domain once in one install.',
      )
    }
    seen.add(url)
  }
}

function refuseDuplicateOrigins(roots: readonly PlannedRoot[]): void {
  const byOrigin = new Map<string, string[]>()
  for (const { source, origin } of roots) {
    if (origin === undefined) continue
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), source.reference])
  }
  for (const [origin, named] of byOrigin) {
    if (named.length > 1) {
      throw new AstraleError(
        'DUPLICATE_ORIGIN',
        `Origin ${origin} is served by several references: ${named.join(', ')}.`,
        'One install pins one deployment per origin; keep the reference you mean.',
      )
    }
  }
}

/**
 * The command that resends this install under the same operation id: every version by the exact
 * version it resolved to (a line could resolve to a newer version meanwhile), every URL as
 * written, and the consents the install carried, each change by its origin, never a prompt.
 */
function releaseInstallRetry(
  sources: readonly ReleaseSource[],
  operation: string,
  opts: ReferenceInstallOpts,
  changes: readonly (IssuerChange | undefined)[],
  overridden: readonly (string | undefined)[],
): string {
  return installCommand(sources.map(installedReference), opts, changes, overridden, {
    operation,
    registry: sources.some((source) => source.publication !== undefined),
  })
}

/** A reference as an install names it again: a version by the exact version it resolved to. */
function installedReference(source: ReleaseSource): string {
  return source.publication === undefined ? source.reference : exactReference(source.publication)
}

/**
 * One `astrale domain install` command line for `references`, with the target, identity and
 * consents of this install, the Admin target when a version reference needs the registry, and the
 * operation id only when the command resends this very install.
 */
function installCommand(
  references: readonly string[],
  opts: ReferenceInstallOpts,
  changes: readonly (IssuerChange | undefined)[],
  overridden: readonly (string | undefined)[],
  options: { readonly operation?: string; readonly registry: boolean },
): string {
  const operation = options.operation === undefined ? '' : ` --operation ${options.operation}`
  const url = opts.url === undefined ? '' : ` --url ${opts.url}`
  const instance = opts.instance === undefined ? '' : ` -i ${opts.instance}`
  const identity = opts.as === undefined ? '' : ` --as ${opts.as}`
  const admin =
    opts.admin !== undefined
      ? ` --admin ${opts.admin}`
      : opts.adminUrl !== undefined
        ? ` --admin-url ${opts.adminUrl}${opts.domainIssuer === undefined ? '' : ` --domain-issuer ${opts.domainIssuer}`}`
        : ''
  const consents = changes
    .filter((change): change is IssuerChange => change !== undefined)
    .map((change) => ` --allow-issuer-change=${change.origin}`)
    .join('')
  const revoke = opts.revokePrevious === true ? ' --revoke-previous' : ''
  const override = overridden.some((origin) => origin !== undefined)
    ? ' --allow-identity-override'
    : ''
  const registry = options.registry ? admin : ''
  return `astrale domain install ${references.join(' ')}${operation}${consents}${revoke}${override}${url}${instance}${identity}${registry}`
}

function pinMismatchError(mismatched: readonly InstallReference[]): AstraleError {
  const named = mismatched
    .map(
      (reference) =>
        `${reference.origin} (expected ${pinLabel(reference.pin!)} from ${reference.url})`,
    )
    .join(', ')
  return new AstraleError(
    'INSTALLED_PIN_MISMATCH',
    `The Kernel reports another installed release than the one the install expected: ${named}.`,
    'Another install may have run meanwhile. Read the installed releases with `astrale introspect` and install again.',
  )
}

/** What the install did to one root, as the Kernel's result says. */
export type RootStatus = 'installed' | 'replaced' | 'unchanged' | 'unknown'

/**
 * The status of the root installed from `origin`, read from the Kernel's result alone: a committed
 * transition without a previous generation installed it, one with a previous generation replaced
 * it, and a root without a transition did not move. `unknown` when the origin was not readable.
 */
export function rootStatus(result: InstallResult, origin: string | null): RootStatus {
  if (!result.changed) return 'unchanged'
  if (origin === null) return 'unknown'
  const intent = result.receipt.transitions.find(
    (transition) => transition.intent.origin === origin,
  )?.intent
  if (intent === undefined) return 'unchanged'
  if (intent.previous === null) return 'installed'
  return intent.previous.generation === intent.generation?.generation ? 'unchanged' : 'replaced'
}

/**
 * One line per root ([.78492]): its origin, what the install did to it, the version a version
 * reference resolved to, and the release it pins.
 */
function presentReferences(
  references: readonly InstallReference[],
  operation: string,
  result: InstallResult,
): void {
  log.success(
    `${references.length === 1 ? 'Domain' : 'Domains'} ${result.changed ? 'installed' : 'already current'} (operation ${operation})`,
  )
  const width = Math.max(
    ...references.map((reference) => (reference.origin ?? reference.url).length),
  )
  for (const reference of references) {
    const installed = reference.installed
    const status = rootStatus(result, reference.origin)
    const pin = installed?.pin ?? reference.pin
    const version =
      reference.version === undefined
        ? ''
        : `${chalk.bold(reference.version)}${reference.yanked === true ? chalk.yellow(' (yanked)') : ''} `
    // The listings only detail a replacement: the Kernel's result alone decides the status.
    const was =
      status === 'replaced' && reference.previous !== null
        ? chalk.dim(` (was ${pinLabel(reference.previous.pin)})`)
        : ''
    console.log(
      `  ${(reference.origin ?? reference.url).padEnd(width)}  ${status.padEnd(9)}  ${version}${pin === null ? chalk.dim('pin not read') : pinLabel(pin)}${was}`,
    )
  }
}

function pinLabel(pin: InstalledPin): string {
  return pin.kind === 'release'
    ? `release ${shortDigest(pin.release)}`
    : `legacy v${pin.document} ${shortDigest(pin.etag)}`
}

function shortDigest(digest: string): string {
  return digest.startsWith('sha256:') ? `sha256:${digest.slice(7, 19)}` : digest
}

/** The host name a URL reference is served from; any http(s) URL, as before installs were grouped. */
export function validateInstallUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new AstraleError(
      'INVALID_DOMAIN_URL',
      `Domain install source must be an http(s) URL, got "${value}".`,
      'Run or deploy the domain service, then install its base URL, for example: astrale domain install https://contract.astrale.ai',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AstraleError(
      'INVALID_DOMAIN_URL',
      `Domain install URL must use http or https, got "${url.protocol}".`,
    )
  }
  return url.hostname
}
