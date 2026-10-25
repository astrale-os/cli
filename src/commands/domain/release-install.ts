import type {
  Installation,
  InstalledPin,
  InstalledRelease,
  InstallRequest,
  InstallResult,
} from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'
import type { NodeId } from '@astrale-os/sdk/graph/node'

import { ResponseError } from '@astrale-os/sdk/client'
import { parseReference } from '@astrale-os/sdk/versioning'
import chalk from 'chalk'

import type { AdminRegistryApi } from '../../admin/registry'
import type { KernelCommandOpts } from '../../connection'
import type { AdminTargetCommandOpts } from '../../lib/admin/target'
import type { InstallFailure } from './install-call'
import type { DependentProposal, InstallPrecheck, PrecheckRoot } from './install-precheck'
import type { ResolvedVersion, VersionReference } from './version-reference'

import { connectAdminRegistry, RegistryError, registryFailure } from '../../admin/registry'
import { adminSessionOptions, withAdminClientSession, withClientSession } from '../../connection'
import {
  announcingLifecycle,
  completedExecutionLine,
  IncompleteInstallation,
  installationResult,
  openSessionReport,
  renderOpenSession,
  renderRunning,
  runningReport,
  conflictFailure,
  replayedMember,
  replayLine,
  stillRunning,
  type Lifecycle,
} from '../../connection/installation-result'
import { reasonCode } from '../../connection/reasons'
import { commandWait } from '../../connection/session'
import { targetFlags } from '../../connection/target'
import { AstraleError } from '../../errors'
import {
  DeploymentReadError,
  readReleaseBundle,
  readServedDeployment,
  samePin,
  type ServedDeployment,
} from '../../lib/deployment/release'
import { shellCommand } from '../../lib/shell-command'
import { fatal, log } from '../../lib/terminal/log'
import { isMachine, output } from '../../lib/terminal/output'
import { exitWithInstallFailure, runInstallCall } from './install-call'
import { precheckInstall, proposeDependentVersions } from './install-precheck'
import {
  admitIssuerChanges,
  firstInstallNotice,
  issuerChangeConsent,
  issuerConsentRequest,
  plannedIssuerChange,
  type IssuerChange,
  type IssuerChangeConsent,
} from './issuer-consent'
import { acceptDomainOperationId, createDomainOperationId } from './operation'
import {
  admitVersionReference,
  exactReference,
  isVersionReference,
  resolveVersionReferences,
} from './version-reference'

/**
 * How long the CLI's read of a deployment that answers 503 (not serving yet) is retried. Only that
 * read is retried: the Kernel refuses its own failed read as SCHEMA_BACKEND_FAILED with empty
 * details, the code it also gives backend failures, so a refused install is never sent again
 * (AM-97).
 */
const NOT_YET_ACTIVE_WINDOW_MS = 60_000

export type ReferenceInstallOpts = KernelCommandOpts &
  AdminTargetCommandOpts & {
    readonly mode?: 'online' | 'maintenance'
    readonly validationScope?: 'incremental' | 'full'
    readonly validationCounts?: 'sample' | 'exact'
    readonly wait?: boolean
    readonly operation?: string
    readonly token?: string
    /** Every `--allow-issuer-change` occurrence: `''` without an origin, else the origin it names. */
    readonly allowIssuerChange?: readonly string[]
    readonly revokePrevious?: boolean
  }

type InstalledState = Pick<InstalledRelease, 'revision' | 'pin' | 'issuer'>

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
interface InstallReference {
  readonly reference: string
  readonly origin: string | null
  readonly url: string
  readonly version?: string
  readonly yanked?: true
  readonly pin: InstalledPin | null
  readonly previous: InstalledState | null
  readonly installed: InstalledState | null
  /** CT24: the issuer it replaced, its replacement, and whether the replaced one drains or is revoked. */
  readonly consent?: { readonly from: string; readonly to: string; previous: 'drain' | 'revoke' }
}

/**
 * `--json` of an install: the Kernel result, unchanged, its Execution and status, and one entry per
 * reference.
 */
type InstallReport = InstallResult & {
  readonly execution: Installation['execution']
  readonly status: Installation['status']
  readonly references: readonly InstallReference[]
  /** The Kernel's marker: whether its answer replayed the operation's recorded Execution. */
  readonly replayed?: boolean
  /** The advisory pre-check this install ran before it was sent ([.78239] [.69634]). */
  readonly precheck: InstallPrecheck
}

export interface ReferenceInstallDependencies {
  readonly createOperationId: () => string
  readonly withClientSession: typeof withClientSession
  /**
   * The install syscall of a session, telling `started` the Execution the Kernel answered and its
   * replay marker.
   */
  readonly lifecycle: (
    session: ClientSession,
    started: (execution: NodeId, replayed?: boolean) => void,
  ) => Lifecycle
  /**
   * Opens the Admin registry of the configured Admin target (`--admin`, `--admin-url`, or the CLI
   * configuration) with the caller's own identity ([.79495]): never the install target that
   * `-i`/`--url` select, and never `--creds`, the raw credential of that target.
   */
  readonly openRegistry: <Value>(
    opts: ReferenceInstallOpts,
    work: (registry: Pick<AdminRegistryApi, 'index'>) => Promise<Value>,
  ) => Promise<Value>
  readonly readDeployment: (url: string, signal?: AbortSignal) => Promise<ServedDeployment>
  /** Reads the Schema Bundle a served release names, for the pre-check. */
  readonly readBundle: typeof readReleaseBundle
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}

const defaultDependencies: ReferenceInstallDependencies = {
  createOperationId: () => createDomainOperationId('install'),
  withClientSession,
  lifecycle: announcingLifecycle,
  openRegistry: (opts, work) =>
    withAdminClientSession(adminSessionOptions(opts), async (context) =>
      work(connectAdminRegistry(context)),
    ),
  readDeployment: readServedDeployment,
  readBundle: readReleaseBundle,
  now: Date.now,
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}

/**
 * One root of an install: the reference as the operator wrote it and the deployment URL it names.
 * A version reference also carries the Publication it resolved to, whose release the Kernel must
 * find at that URL.
 */
interface ReleaseSource {
  readonly reference: string
  readonly url: string
  readonly publication?: ResolvedVersion
}

/** One reference as written: a deployment URL, or a version the registry resolves. */
type WrittenReference =
  | { readonly kind: 'url'; readonly reference: string }
  | { readonly kind: 'version'; readonly reference: string; readonly version: VersionReference }

/**
 * What the CLI knows of one root before the install: what its URL serves, its origin (named by its
 * version reference, else read from what its URL serves) and the pin the install expects.
 */
interface PlannedRoot {
  readonly source: ReleaseSource
  readonly served: ServedDeployment | undefined
  readonly origin: string | undefined
  readonly expected: Extract<InstalledPin, { readonly kind: 'release' }> | null
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
 * The Kernel receives the `release` request, guarded by the release digest each root must serve
 * (the Publication's for a version, the one read from the URL otherwise; [.78352]) and carrying
 * the operator's consent for each root whose issuer it changes (D7).
 */
export async function installByReference(
  references: readonly [string, ...string[]],
  opts: ReferenceInstallOpts,
  dependencies: Partial<ReferenceInstallDependencies> = {},
): Promise<void> {
  const deps = { ...defaultDependencies, ...dependencies }
  let written: readonly WrittenReference[]
  let operation: string
  let consent: IssuerChangeConsent
  try {
    consent = issuerChangeConsent(opts.allowIssuerChange, opts.revokePrevious)
    written = references.map((reference): WrittenReference =>
      isVersionReference(reference)
        ? { kind: 'version', reference, version: admitVersionReference(reference) }
        : { kind: 'url', reference: admitInstallUrl(reference) },
    )
    // The syntax names the origin of a version, so two versions of one origin are refused before
    // Admin is opened; a URL names its origin only once it is read.
    refuseRepeated(
      written.map((entry) => [
        entry.kind === 'url' ? new URL(entry.reference).origin : entry.version.selector.origin,
        entry.reference,
      ]),
    )
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
        : acceptDomainOperationId(opts.operation, 'install')
  } catch (error) {
    fatal(error, opts)
  }

  const versions = written.flatMap((entry) => (entry.kind === 'version' ? [entry.version] : []))
  let sources: readonly ReleaseSource[]
  try {
    const resolved =
      versions.length === 0
        ? []
        : await deps.openRegistry(opts, (registry) => resolveVersionReferences(versions, registry))
    let next = 0
    sources = written.map((entry): ReleaseSource => {
      if (entry.kind === 'url') return { reference: entry.reference, url: entry.reference }
      const publication = resolved[next++]!
      return { reference: publication.reference, url: publication.url, publication }
    })
    refuseRepeated(sources.map(({ url, reference }) => [new URL(url).origin, reference]))
  } catch (error) {
    fatal(registryFailure(error, 'read'), opts)
  }
  if (!isMachine(opts)) {
    for (const { publication } of sources) {
      if (publication?.yanked === true) {
        log.warn(
          `${publication.origin} ${publication.version} is yanked: it is installed only because ${publication.reference} names it exactly.`,
        )
      }
    }
  }

  const failure = await deps
    .withClientSession(
      opts,
      async ({ session }) =>
        installReleases(session, sources, await session.schema.installed(), {
          operation,
          consent,
          opts,
          deps,
        }),
      { principal: 'caller' },
    )
    .catch((error: unknown): InstallFailure => ({ error, render: 'kernel' }))
  if (failure !== undefined) await exitWithInstallFailure(failure, opts)
}

/** What every step of one install shares. */
interface InstallRun {
  readonly operation: string
  readonly consent: IssuerChangeConsent
  readonly opts: ReferenceInstallOpts
  readonly deps: ReferenceInstallDependencies
}

/** What the install call gives the presentation: the Kernel result and the listing read after it. */
interface InstallOutcome {
  readonly installation: Installation
  readonly result: InstallResult
  readonly after: readonly InstalledRelease[] | undefined
}

/**
 * What an install answers: its outcome, the maintenance session it opened, awaiting Root, or its
 * Execution still running when the command stopped waiting.
 */
type InstallAnswer =
  | InstallOutcome
  | { readonly session: Installation }
  | { readonly running: Installation }

/** A session watch reads the status again at most a second after its last read. */
const WATCH_PAUSE_MS = 1_000
/** What a status read of a session watch has past the command's deadline to come back. */
const WATCH_READ_GRACE_MS = 1_000

async function installReleases(
  session: ClientSession,
  sources: readonly ReleaseSource[],
  before: readonly InstalledRelease[],
  run: InstallRun,
): Promise<InstallFailure | undefined> {
  const { operation, consent, opts } = run
  const machine = isMachine(opts)
  const knownIssuers = new Map(before.map(({ origin, issuer }) => [origin, issuer]))
  let roots: readonly PlannedRoot[]
  let changes: readonly (IssuerChange | undefined)[]
  try {
    roots = plannedRoots(sources, await readServed(sources, run.deps, machine))
    refuseRepeated(roots.map(({ origin, source }) => [origin, source.reference]))
    refuseUnknownConsentOrigins(consent, roots)
    changes = await Promise.all(
      roots.map((root) => plannedChange(session, root, before, knownIssuers)),
    )
    for (const [index, { source, served }] of roots.entries()) {
      // A version names its deployment through Admin's registry, so only a URL claims an origin.
      if (
        !machine &&
        source.publication === undefined &&
        changes[index] === undefined &&
        served !== undefined &&
        !knownIssuers.has(served.origin)
      ) {
        const notice = firstInstallNotice(served, source.url)
        if (notice !== undefined) log.warn(notice)
      }
    }
  } catch (error) {
    return { error, render: 'input' }
  }
  // The pre-check informs the operator's issuer consent, so it is shown before that prompt.
  // Advisory: a defect anywhere in it reports every root failed and the install is still sent.
  const precheck = await precheckReferences(session, roots, before, changes, run).catch(() =>
    failedPrecheck(roots),
  )
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
  if (!machine) {
    warnUnreadableConsentOrigins(consent, roots, knownIssuers)
    if (consent.revokePrevious && changes.every((change) => change === undefined)) {
      log.dim('  --revoke-previous: no installed issuer changes, so there is nothing to revoke.')
    }
  }

  // --timeout bounds the whole install, its wait included; --no-wait answers at once.
  const { wait, options } = commandWait(opts.timeout)
  const request = {
    operation,
    ...(opts.mode === undefined ? {} : { mode: opts.mode }),
    waitMs: opts.wait === false ? 0 : wait.waitMs,
    ...(opts.validationScope === undefined && opts.validationCounts === undefined
      ? {}
      : {
          validation: {
            ...(opts.validationScope === undefined ? {} : { scope: opts.validationScope }),
            ...(opts.validationCounts === undefined ? {} : { counts: opts.validationCounts }),
          },
        }),
    domains: roots.map(({ source, expected }, index) => {
      const change = changes[index]
      return {
        release: {
          url: source.url,
          ...(opts.token === undefined ? {} : { token: opts.token }),
          ...(expected === null ? {} : { digest: expected.release }),
        },
        ...(change === undefined ? {} : { consent: issuerConsentRequest(change, consent) }),
      }
    }),
  } as unknown as InstallRequest
  let mismatched: readonly InstallReference[] = []
  // The resend names every version by the exact version it resolved to: a line could resolve to
  // a newer version meanwhile.
  const recovery = {
    operation,
    fresh: installCommand(sources.map(namedAgain), opts, changes),
    target: targetFlags(opts),
  }
  const failure = await runInstallCall<InstallAnswer>(opts, {
    lifecycle: 'install',
    label:
      sources.length === 1
        ? `Installing domain from ${sources[0]!.reference} (operation ${operation})`
        : `Installing ${sources.length} domains (operation ${operation})`,
    recovery,
    call: async (started) => {
      const deadline = run.deps.now() + wait.waitMs
      let installation: Installation
      try {
        installation = await run.deps.lifecycle(session, started).install(request, options)
      } catch (error) {
        // A conflict over the operation refuses this install: the request it names is read only
        // to say which one it is.
        throw await conflictFailure(error, session.schema)
      }
      // A maintenance session drains the Instance, then awaits Root's command: what it asked for.
      if (opts.mode === 'maintenance') {
        if (opts.wait !== false) {
          installation = await watchSession(session, installation, deadline, run.deps)
        }
        if (installation.status.detail?.phase === 'awaiting') return { session: installation }
      }
      if (stillRunning(installation.status)) return { running: installation }
      const result = installationResult(installation)
      return { installation, result, after: await installedAfter(session, machine) }
    },
    running: (answer) => 'running' in answer,
    format: (answer, raw, context) => {
      if ('running' in answer) {
        if (raw) output({ ...runningReport(answer.running, context), precheck }, opts)
        else renderRunning(answer.running, context, opts.wait !== false)
        return
      }
      if ('session' in answer) {
        if (raw) output({ ...openSessionReport(answer.session, context), precheck }, opts)
        else renderOpenSession(answer.session, context)
        return
      }
      const { installation, result, after } = answer
      const report = installReferences(roots, before, after, changes, consent)
      mismatched = report.filter((reference) => {
        const installed = after?.find((entry) => entry.origin === reference.origin)
        return (
          reference.pin !== null &&
          installed !== undefined &&
          !installedAsExpected(installed, reference.pin, reference.url)
        )
      })
      if (raw) {
        output(
          {
            ...result,
            execution: installation.execution,
            status: installation.status,
            ...replayedMember(context),
            references: report,
            precheck,
          } satisfies InstallReport,
          opts,
        )
        return
      }
      presentReferences(report, operation, result)
      log.dim(`  ${completedExecutionLine(installation)}`)
      const replayed = replayLine(context, installation.status)
      if (replayed !== undefined) log.dim(`  ${replayed}`)
      for (const [index, { origin, consent: change }] of report.entries()) {
        if (change === undefined) continue
        log.dim(
          `  ${origin}: issuer ${change.from} -> ${change.to} ` +
            `(${changes[index]?.line === 'same' ? 'same line' : 'another line'}; ` +
            `the previous issuer ${change.previous === 'revoke' ? 'is revoked' : 'drains'})`,
        )
      }
      for (const reference of report) {
        if (reference.installed === null && after !== undefined) {
          log.warn(
            `The installation of ${reference.origin ?? reference.reference} is not readable by this identity; its pin was not verified.`,
          )
        }
      }
    },
  })
  if (failure !== undefined) {
    // Only a refusal the pre-check predicts is shown beside it. A transport failure or an unknown
    // outcome is never replaced by the proposed install.
    const predicted = ['SCHEMA_DEPENDENCY_INCOMPATIBLE', 'SCHEMA_DEPENDENTS_INCOMPATIBLE'].includes(
      failure.error instanceof IncompleteInstallation &&
        failure.error.installation.status.outcome?.kind === 'failed'
        ? failure.error.installation.status.outcome.error.code
        : failure.error instanceof ResponseError
          ? (reasonCode(failure.error.reason) ?? '')
          : '',
    )
    return predicted ? { ...failure, precheck } : failure
  }
  if (mismatched.length > 0) return { error: pinMismatchError(mismatched), render: 'input' }
  return undefined
}

/**
 * Read what each root's URL serves. A deployment that answers 503 (not serving yet) is read again
 * until {@link NOT_YET_ACTIVE_WINDOW_MS} after the first 503 of the install, a window every root
 * shares. The CLI only reads what the URL serves to guard and report the install; the Kernel reads
 * it again and stays the authority, so an unreadable document is installed without a digest read
 * from it: a version still carries the one its Publication names.
 */
async function readServed(
  sources: readonly ReleaseSource[],
  deps: ReferenceInstallDependencies,
  machine: boolean,
): Promise<readonly (ServedDeployment | undefined)[]> {
  let deadline: number | undefined
  return Promise.all(
    sources.map(async ({ url, publication }) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await deps.readDeployment(url, AbortSignal.timeout(10_000))
        } catch (error) {
          if (error instanceof DeploymentReadError && error.retryable) {
            const now = deps.now()
            deadline ??= now + NOT_YET_ACTIVE_WINDOW_MS
            if (deadline > now) {
              const backoff = Math.min(1_000 * 2 ** Math.min(attempt, 4), 10_000)
              await deps.sleep(Math.min(error.retryAfterMs ?? backoff, deadline - now))
              continue
            }
          }
          if (!machine) {
            log.warn(
              `Could not read what ${url} serves (${error instanceof Error ? error.message : 'unreadable'}) — ` +
                (publication === undefined
                  ? 'installing it without an expected release digest; the installed pin is reported after install.'
                  : `installing it with the release digest ${publication.origin} ${publication.version} names; the Kernel refuses any other release.`),
            )
          }
          return undefined
        }
      }
    }),
  )
}

/**
 * The roots of an install. A version is installed only from a deployment that serves the release
 * its Publication names ([.78352]): a deployment the CLI reads serving another release is refused
 * before anything is sent. A deployment the CLI cannot read is left to the Kernel, which receives
 * the Publication's release digest and refuses any other release.
 */
function plannedRoots(
  sources: readonly ReleaseSource[],
  served: readonly (ServedDeployment | undefined)[],
): readonly PlannedRoot[] {
  return sources.map((source, index) => {
    const { publication } = source
    const deployment = served[index]
    if (
      publication !== undefined &&
      deployment !== undefined &&
      deployment.pin.release !== publication.pin.release
    ) {
      throw new RegistryError(
        'PUBLICATION_RELEASE_MISMATCH',
        `${publication.url} no longer serves the release ${publication.origin} ${publication.version} names (${publication.pin.release}); nothing was installed.`,
        {
          origin: publication.origin,
          version: publication.version,
          url: publication.url,
          expected: publication.pin.release,
          served: deployment.pin.release,
        },
      )
    }
    return {
      source,
      served: deployment,
      origin: publication?.origin ?? deployment?.origin,
      expected: publication?.pin ?? deployment?.pin ?? null,
    }
  })
}

/**
 * The issuer change installing one root makes. The installed listing is caller-scoped and omits
 * registrations with no deployment pin, so its omission does not establish a first install: the
 * root's origin is read before consent is planned, without inventing an installed release or
 * broadening access, and the issuer it shows joins `knownIssuers`.
 */
async function plannedChange(
  session: ClientSession,
  { source, served }: PlannedRoot,
  before: readonly InstalledRelease[],
  knownIssuers: Map<string, string>,
): Promise<IssuerChange | undefined> {
  if (served === undefined) return undefined
  if (before.some((entry) => entry.origin === served.origin)) {
    return plannedIssuerChange(source.url, served, before)
  }
  let installed
  try {
    installed = await session.schema.inspect(served.origin as never)
  } catch (error) {
    if (isAbsentDomain(error)) return undefined
    throw error
  }
  const issuer = installed.release?.identity.issuer
  if (issuer === undefined) return undefined
  knownIssuers.set(installed.origin, issuer)
  return plannedIssuerChange(source.url, served, [{ origin: installed.origin, issuer }])
}

/** Join what each root expected with the installed listings read before and after. */
function installReferences(
  roots: readonly PlannedRoot[],
  before: readonly InstalledRelease[],
  after: readonly InstalledRelease[] | undefined,
  changes: readonly (IssuerChange | undefined)[],
  consent: IssuerChangeConsent,
): readonly InstallReference[] {
  return roots.map(({ source, origin: planned, expected }, index) => {
    const change = changes[index]
    const url = new URL(source.url).origin
    const origin = planned ?? after?.find((installed) => installed.url === url)?.origin ?? null
    const state = (listing: readonly InstalledRelease[] | undefined): InstalledState | null => {
      const installed = listing?.find((entry) => origin !== null && entry.origin === origin)
      return installed === undefined
        ? null
        : { revision: installed.revision, pin: installed.pin, issuer: installed.issuer }
    }
    const { publication } = source
    return {
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
            consent: {
              from: change.from,
              to: change.to,
              previous: consent.revokePrevious ? ('revoke' as const) : ('drain' as const),
            },
          }),
    }
  })
}

/** Whether an installation pins what the install expected, from the deployment it named. */
function installedAsExpected(
  installed: InstalledRelease,
  expected: InstalledPin,
  url: string,
): boolean {
  return samePin(expected, installed.pin) && installed.url === new URL(url).origin
}

/**
 * Run the advisory pre-check of one install ([.78239] [.69634]) and, for each broken dependent,
 * read the registry for a compatible version to propose. Only a broken dependent opens the
 * registry, so an install of URLs that the pre-check passes never reads Admin. What the CLI
 * cannot read is reported as skipped or unevaluated, and the install is sent for the Kernel to
 * decide.
 */
async function precheckReferences(
  session: ClientSession,
  roots: readonly PlannedRoot[],
  before: readonly InstalledRelease[],
  changes: readonly (IssuerChange | undefined)[],
  { opts, deps }: InstallRun,
): Promise<InstallPrecheck> {
  const checked = await Promise.all(
    roots.map(async ({ source, served, origin }): Promise<PrecheckRoot> => {
      const skip = (
        reason: Extract<PrecheckRoot, { kind: 'skipped' }>['reason'],
      ): PrecheckRoot => ({
        kind: 'skipped',
        reference: source.reference,
        ...(origin === undefined ? {} : { origin }),
        ...(served === undefined ? {} : { revision: served.revision }),
        reason,
      })
      if (served === undefined) return skip('release-unread')
      try {
        const bundle = await deps.readBundle(
          served.release,
          source.url,
          AbortSignal.timeout(10_000),
        )
        return {
          kind: 'release',
          reference: source.reference,
          origin: served.origin,
          release: served.release,
          bundle,
        }
      } catch {
        return skip('bundle-unread')
      }
    }),
  )
  const { indirect, ...verdict } = await precheckInstall(checked, before, session.schema)
  // A dependent that breaks on a dependency it reaches only through another Domain has no answer
  // in the registry, so only the others open it.
  const direct = verdict.dependents.filter(({ domain }) => !indirect.has(domain.origin))
  const registered =
    direct.length === 0
      ? []
      : await deps
          .openRegistry(opts, (registry) => proposeDependentVersions(direct, before, registry))
          .catch((error: unknown) => {
            const { code } = registryFailure(error, 'read')
            return uniqueOrigins(direct).map((origin): DependentProposal => ({
              origin,
              kind: 'unread',
              code,
            }))
          })
  const proposals = uniqueOrigins(verdict.dependents).map((origin): DependentProposal => {
    const through = indirect.get(origin)
    return through === undefined
      ? registered.find((proposal) => proposal.origin === origin)!
      : { origin, kind: 'indirect', dependencies: through }
  })
  const versions = proposals.flatMap((proposal) =>
    proposal.kind === 'version' ? [`${proposal.origin}@${proposal.version}`] : [],
  )
  const command =
    proposals.length > 0 && versions.length === proposals.length
      ? installCommand(
          [...roots.map(({ source }) => namedAgain(source)), ...versions],
          opts,
          changes,
        )
      : undefined
  return { ...verdict, proposals, ...(command === undefined ? {} : { command }) }
}

function uniqueOrigins(dependents: InstallPrecheck['dependents']): readonly string[] {
  return [...new Set(dependents.map(({ domain }) => domain.origin))]
}

/** The pre-check of an install it could not run: every root is reported failed, nothing predicted. */
function failedPrecheck(roots: readonly PlannedRoot[]): InstallPrecheck {
  return {
    compared: 0,
    dependencies: [],
    dependents: [],
    skipped: roots.map(({ source }) => ({ reference: source.reference, reason: 'failed' })),
    unevaluated: [],
    proposals: [],
  }
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
  const count = precheck.unevaluated.length
  if (count > 0) {
    log.dim(
      `  Pre-check could not evaluate ${count === 1 ? '1 Domain' : `${count} Domains`} (${precheck.unevaluated.join(', ')}): ` +
        `${count === 1 ? 'its' : 'their'} installed schema or bindings are not readable here, or the engine could not compare them.`,
    )
  }
  if (precheck.dependencies.length > 0 || precheck.dependents.length > 0) {
    log.dim('  The pre-check is advisory: the install is sent and the Kernel decides.')
  } else if (precheck.compared > 0) {
    log.dim(
      `  Pre-check: ${precheck.compared} dependency ${precheck.compared === 1 ? 'binding holds' : 'bindings hold'}; the Kernel checks again.`,
    )
  }
}

const SKIPPED: Readonly<Record<InstallPrecheck['skipped'][number]['reason'], string>> = {
  'release-unread': 'what its deployment serves could not be read.',
  'bundle-unread': 'the Schema Bundle its release names could not be read.',
  failed: 'the pre-check failed; the Kernel still checks the install.',
}

function changesLabel(changes: InstallPrecheck['dependencies'][number]['changes']): string {
  const shown = changes.slice(0, 3).map(({ key, kind }) => `${key} ${kind}`)
  return changes.length > 3
    ? `${shown.join(', ')} and ${changes.length - 3} more`
    : shown.join(', ')
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
  const origins = roots.map((root) => root.origin)
  if (origins.includes(undefined)) return
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
 * listing and the exact root's installed publication, never from a Kernel refusal. Either the
 * origin is not installed or neither observation exposes its issuer; the operator is told before
 * the send.
 */
function warnUnreadableConsentOrigins(
  consent: IssuerChangeConsent,
  roots: readonly PlannedRoot[],
  knownIssuers: ReadonlyMap<string, string>,
): void {
  for (const origin of consent.origins) {
    if (knownIssuers.has(origin) || !roots.some((root) => root.origin === origin)) continue
    log.warn(
      `--allow-issuer-change=${origin}: ${origin} is not among the installations this identity can read, so no consent is sent. ` +
        'If it is installed, consenting to its issuer change needs read access to its installation.',
    )
  }
}

/**
 * Follow a maintenance session until it awaits Root's command, ends or pauses, within `deadline`,
 * at the pace of the Kernel client's `installation.watch`: each status read follows the last one
 * after a quarter of the time watched, never less than that read took nor 1 ms, and never more
 * than a second, so the session is seen within a quarter of the time it took to await. A session
 * first drains the Instance's open work.
 */
async function watchSession(
  session: ClientSession,
  installation: Installation,
  deadline: number,
  deps: Pick<ReferenceInstallDependencies, 'now' | 'sleep'>,
): Promise<Installation> {
  const { execution } = installation
  let { status } = installation
  const started = deps.now()
  let took = 0
  while (
    status.outcome === undefined &&
    status.state !== 'paused' &&
    status.detail?.phase !== 'awaiting'
  ) {
    const now = deps.now()
    const left = deadline - now
    if (left <= 0) break
    await deps.sleep(
      Math.min(WATCH_PAUSE_MS, Math.max(1, took, Math.ceil((now - started) / 4)), left),
    )
    const read = deps.now()
    status = await session.schema.installation.status(execution, {
      timeoutMs: Math.max(1, deadline - read) + WATCH_READ_GRACE_MS,
    })
    took = deps.now() - read
  }
  return { ...installation, status }
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

/** Admit a reference that names no version: an http(s) URL written as the Kernel reads it. */
function admitInstallUrl(reference: string): string {
  try {
    parseReference(reference)
  } catch (cause) {
    throw new AstraleError(
      'INVALID_DOMAIN_URL',
      (cause as TypeError).message,
      'Write the deployment URL as the Kernel reads it, for example https://crm.acme.dev',
      { cause },
    )
  }
  return reference
}

/**
 * One install pins one release per origin and reads each deployment once: a key (an origin, or a
 * deployment URL's origin) named by several references is refused. An unknown key is skipped.
 */
function refuseRepeated(named: readonly (readonly [string | undefined, string])[]): void {
  const byKey = new Map<string, string[]>()
  for (const [key, reference] of named) {
    if (key !== undefined) byKey.set(key, [...(byKey.get(key) ?? []), reference])
  }
  for (const [key, references] of byKey) {
    if (references.length > 1) {
      throw new AstraleError(
        'DUPLICATE_ORIGIN',
        `${key} is named by several references: ${references.join(', ')}.`,
        'Name each Domain once in one install; keep the reference you mean.',
      )
    }
  }
}

/** A reference as an install names it again: a version by the exact version it resolved to. */
function namedAgain(source: ReleaseSource): string {
  return source.publication === undefined ? source.reference : exactReference(source.publication)
}

/**
 * One `astrale domain install` command line for `references`, with a fresh operation, the target,
 * identity and consents of this install (each change by its origin, never a prompt), and the Admin
 * target when a version reference needs the registry.
 */
function installCommand(
  references: readonly string[],
  opts: ReferenceInstallOpts,
  changes: readonly (IssuerChange | undefined)[],
): string {
  const flag = (name: string, value: string | undefined) =>
    value === undefined ? [] : [name, value]
  const admin = !references.some(isVersionReference)
    ? []
    : opts.admin !== undefined
      ? flag('--admin', opts.admin)
      : opts.adminUrl === undefined
        ? []
        : [...flag('--admin-url', opts.adminUrl), ...flag('--domain-issuer', opts.domainIssuer)]
  return shellCommand([
    'astrale',
    'domain',
    'install',
    ...references,
    ...flag('--mode', opts.mode),
    ...flag('--validation-scope', opts.validationScope),
    ...flag('--validation-counts', opts.validationCounts),
    ...(opts.wait === false ? ['--no-wait'] : []),
    ...changes.flatMap((change) =>
      change === undefined ? [] : [`--allow-issuer-change=${change.origin}`],
    ),
    ...(opts.revokePrevious === true ? ['--revoke-previous'] : []),
    ...targetFlags(opts),
    ...flag('--timeout', opts.timeout),
    ...admin,
  ])
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

/**
 * The status of the root installed from `origin`, read from the Kernel's result alone: a committed
 * transition without a previous generation installed it, one with a previous generation replaced
 * it, and a root without a transition did not move. `unknown` when the origin was not readable.
 */
function rootStatus(
  result: InstallResult,
  origin: string | null,
): 'installed' | 'replaced' | 'unchanged' | 'unknown' {
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
    const status = rootStatus(result, reference.origin)
    const pin = reference.installed?.pin ?? reference.pin
    const version =
      reference.version === undefined
        ? ''
        : `${chalk.bold(reference.version)}${reference.yanked === true ? chalk.yellow(' (yanked)') : ''} `
    // The listings only detail a replacement: the Kernel's result alone decides the status.
    // A replay reads the listing after its install already moved it: no earlier pin to show.
    const was =
      status === 'replaced' &&
      reference.previous !== null &&
      (pin === null || !samePin(reference.previous.pin, pin))
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
    : `artifact ${shortDigest(pin.artifact)}`
}

function shortDigest(digest: string): string {
  return digest.startsWith('sha256:') ? `sha256:${digest.slice(7, 19)}` : digest
}

/**
 * Whether reading an origin's release found no installed Domain: the Kernel answers an origin
 * that is not installed with 1003 and reason SCHEMA_NOT_FOUND. An exact 3002 says the same.
 */
function isAbsentDomain(error: unknown): boolean {
  if (!(error instanceof ResponseError)) return false
  return (
    error.code === 3002 || (error.code === 1003 && reasonCode(error.reason) === 'SCHEMA_NOT_FOUND')
  )
}
