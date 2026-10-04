import type {
  DomainRequest,
  InstalledPin,
  InstalledRelease,
  InstallRequest,
  InstallResult,
} from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'

import { ResponseError } from '@astrale-os/sdk/client'
import { parseReference } from '@astrale-os/sdk/versioning'
import chalk from 'chalk'

import type { ConnectionContext, KernelCommandOpts } from '../../connection'
import type { InstallFailure, UrlSource } from './install-call'

import { withClientSession } from '../../connection'
import { reasonCode } from '../../connection/reasons'
import { AstraleError } from '../../errors'
import {
  DeploymentReadError,
  readServedDeployment,
  samePin,
  type ServedDeployment,
} from '../../lib/domain-release'
import { fatal, log } from '../../lib/log'
import { isMachine, output } from '../../lib/output'
import { exitWithInstallFailure, runInstallCall } from './install-call'
import {
  admitIssuerChange,
  asksIssuerConsent,
  firstInstallNotice,
  issuerChangeConsent,
  issuerConsentRequest,
  plannedIssuerChange,
  type IssuerChange,
  type IssuerChangeConsent,
  type IssuerChangeLine,
  type IssuerConsentRequest,
} from './issuer-consent'
import { consentToDeclaredOrigin, warnUnconfirmedOverride } from './legacy/identity-override'
import { installPublications } from './legacy/publication-install'
import { acceptDomainOperationId, createDomainOperationId } from './operation'

/**
 * How long the CLI's read of a deployment that answers 503 (not serving yet) is retried. Only that
 * read is retried: the Kernel refuses its own failed read as SCHEMA_BACKEND_FAILED with empty
 * details, the code it also gives backend failures, so a refused install is never sent again
 * (AM-97).
 */
export const NOT_YET_ACTIVE_WINDOW_MS = 60_000

export type UrlInstallOpts = KernelCommandOpts & {
  readonly operation?: string
  readonly token?: string
  readonly allowIdentityOverride?: boolean
  /** Every `--allow-issuer-change` occurrence: `''` without an origin, else the origin it names. */
  readonly allowIssuerChange?: readonly string[]
  readonly revokePrevious?: boolean
}

/** The pin, revision and issuer of one installation, as the installed listing reports them. */
export interface InstalledState {
  readonly revision: string
  readonly pin: InstalledPin
  readonly issuer: string
}

/** The issuer consent one reference's root carried (CT9), with the line class it was admitted as. */
export interface ReferenceConsent {
  readonly issuer: { readonly from: string; readonly to: string }
  readonly previous: 'drain' | 'revoke'
  readonly line: IssuerChangeLine
}

/**
 * What one reference installed: the deployment it names, the pin read from what it serves before
 * the install (null when the CLI could not read it), the installation before and after, as the
 * caller can read it (null when absent or not readable), and the issuer consent its root carried,
 * present only when the install changed its issuer.
 */
export interface InstallReference {
  readonly reference: string
  readonly origin: string | null
  readonly url: string
  readonly pin: InstalledPin | null
  readonly previous: InstalledState | null
  readonly installed: InstalledState | null
  readonly consent?: ReferenceConsent
}

/** `--json` of an install by URL: the Kernel result, unchanged, plus one entry per reference. */
export type InstallReport = InstallResult & { readonly references: readonly InstallReference[] }

export interface UrlInstallDependencies {
  readonly acceptOperationId: (input: unknown) => string
  readonly createOperationId: () => string
  readonly withClientSession: typeof withClientSession
  readonly readDeployment: (url: string, signal?: AbortSignal) => Promise<ServedDeployment>
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}

const defaultDependencies: UrlInstallDependencies = Object.freeze({
  acceptOperationId: (input: unknown) => acceptDomainOperationId(input, 'install'),
  createOperationId: () => createDomainOperationId('install'),
  withClientSession,
  readDeployment: (url: string, signal?: AbortSignal) => readServedDeployment(url, signal),
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
})

/**
 * Install every URL reference in one atomic Kernel operation on the instance Kernel. A Kernel that
 * lists installed releases receives the `release` request, guarded by the release digest each URL
 * serves and carrying the operator's consent for each root whose issuer it changes (D7); a Kernel
 * without that listing receives the pre-release `publication` request
 * (`legacy/publication-install.ts`) and takes no issuer consent.
 */
export async function installByUrl(
  references: readonly [string, ...string[]],
  opts: UrlInstallOpts,
  dependencies: Partial<UrlInstallDependencies> = {},
): Promise<void> {
  const deps = { ...defaultDependencies, ...dependencies }
  let sources: readonly [UrlSource, ...UrlSource[]]
  let operation: string
  let consent: IssuerChangeConsent
  try {
    consent = issuerChangeConsent(opts.allowIssuerChange, opts.revokePrevious)
    sources = references.map((url) => ({ url, host: validateInstallUrl(url) })) as [
      UrlSource,
      ...UrlSource[],
    ]
    refuseRepeatedUrls(references)
    if (opts.token !== undefined && references.length > 1) {
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

  let failure: InstallFailure | undefined
  try {
    failure = await deps.withClientSession(
      opts,
      async (context) => {
        const before = await installedReleases(context.session)
        if (before === undefined) {
          if (asksIssuerConsent(consent)) return { error: releaseUnsupported(), render: 'input' }
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
 * One `release` source per reference, guarded by the release digest read from it when it serves
 * one, and carrying the issuer consent of a root whose issuer the install changes.
 */
export function releaseInstallInput(
  references: readonly [string, ...string[]],
  served: readonly (ServedDeployment | undefined)[],
  operation: string,
  token?: string,
  consents: readonly (IssuerConsentRequest | undefined)[] = [],
): InstallRequest {
  const domains = references.map((url, index): DomainRequest => {
    const pin = served[index]?.pin
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

/** Join what each reference served with the installed listings read before and after. */
export function installReferences(
  references: readonly string[],
  served: readonly (ServedDeployment | undefined)[],
  before: readonly InstalledRelease[],
  after: readonly InstalledRelease[] | undefined,
  changes: readonly (IssuerChange | undefined)[] = [],
  consent: IssuerChangeConsent | undefined = undefined,
): readonly InstallReference[] {
  return references.map((reference, index) => {
    const change = changes[index]
    const deployment = served[index]
    const url = new URL(reference).origin
    const origin =
      deployment?.origin ?? after?.find((installed) => installed.url === url)?.origin ?? null
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
    return Object.freeze({
      reference,
      origin,
      url: reference,
      pin: deployment?.pin ?? null,
      previous: state(before),
      installed: state(after),
      ...(change === undefined
        ? {}
        : {
            consent: Object.freeze({
              issuer: Object.freeze({ from: change.from, to: change.to }),
              previous: consent?.revokePrevious === true ? ('revoke' as const) : ('drain' as const),
              line: change.line,
            }),
          }),
    })
  })
}

/**
 * References whose installation does not pin what the CLI read from the URL before the install:
 * another document, or the same origin installed from another deployment.
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
  sources: readonly [UrlSource, ...UrlSource[]],
  before: readonly InstalledRelease[],
  operation: string,
  consent: IssuerChangeConsent,
  opts: UrlInstallOpts,
  deps: UrlInstallDependencies,
): Promise<InstallFailure | undefined> {
  const machine = isMachine(opts)
  const references = sources.map((source) => source.url) as [string, ...string[]]
  const retry = notYetActiveWindow(deps)
  let served: readonly (ServedDeployment | undefined)[]
  let changes: readonly (IssuerChange | undefined)[]
  const overridden: (string | undefined)[] = []
  try {
    for (const reference of references) admitReference(reference)
    served = await Promise.all(
      references.map((reference) => readWithRetry(reference, retry, deps, machine)),
    )
    refuseDuplicateOrigins(references, served)
    refuseUnknownConsentOrigins(consent, served)
    changes = references.map((reference, index) => {
      const deployment = served[index]
      return deployment === undefined
        ? undefined
        : plannedIssuerChange(reference, deployment, before)
    })
    for (const [index, source] of sources.entries()) {
      const deployment = served[index]
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
      const change = changes[index]
      if (change !== undefined) await admitIssuerChange(change, consent, machine)
      else if (deployment !== undefined && !machine && !installedOrigin(before, deployment)) {
        const notice = firstInstallNotice(deployment, source.url)
        if (notice !== undefined) log.warn(notice)
      }
    }
  } catch (error) {
    return { error, render: 'input' }
  }
  if (!machine && consent.revokePrevious && changes.every((change) => change === undefined)) {
    log.dim('  --revoke-previous: no installed issuer changes, so there is nothing to revoke.')
  }

  const request = releaseInstallInput(
    references,
    served,
    operation,
    opts.token,
    changes.map((change) =>
      change === undefined ? undefined : issuerConsentRequest(change, consent),
    ),
  )
  let mismatched: readonly InstallReference[] = []
  const failure = await runInstallCall<InstallOutcome>(opts, {
    label:
      references.length === 1
        ? `Installing domain from ${references[0]} (operation ${operation})`
        : `Installing ${references.length} domains (operation ${operation})`,
    recovery: {
      operation,
      retry: releaseInstallRetry(references, operation, opts, changes, overridden),
    },
    call: async () => {
      try {
        const result = await context.session.schema.install(request)
        return { result, after: await installedAfter(context.session, machine) }
      } catch (error) {
        const held = await committedEarlier(error, context.session, references, served)
        if (held !== undefined) return held
        throw error
      }
    },
    format: ({ result, after, committedEarlier: refusal }, raw) => {
      const report = installReferences(
        references,
        served,
        before,
        after,
        refusal === undefined ? changes : [],
        consent,
      )
      mismatched = pinMismatches(report, after)
      if (raw) {
        output({ ...result, references: report } satisfies InstallReport, opts)
        return
      }
      presentReferences(report, operation, result)
      if (refusal !== undefined) {
        log.dim(
          `  The Kernel refused this install (${refusal}), but every Domain is installed as requested: an earlier install already committed it.`,
        )
      }
      for (const reference of report) {
        if (reference.consent !== undefined) {
          log.dim(
            `  ${reference.origin}: issuer ${reference.consent.issuer.from} -> ${reference.consent.issuer.to} ` +
              `(${reference.consent.line === 'same' ? 'same line' : 'another line'}; ` +
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
  if (failure !== undefined) return failure
  if (mismatched.length > 0) return { error: pinMismatchError(mismatched), render: 'input' }
  return undefined
}

/** What the install call gives the presentation: the Kernel result and the listing read after it. */
interface InstallOutcome {
  readonly result: InstallResult
  readonly after: readonly InstalledRelease[] | undefined
  /** The Kernel refusal of a request whose install had already committed (AM-81). */
  readonly committedEarlier?: string
}

function installedOrigin(
  installed: readonly InstalledRelease[],
  deployment: ServedDeployment,
): boolean {
  return installed.some((entry) => entry.origin === deployment.origin)
}

/**
 * An origin named by `--allow-issuer-change=<origin>` must be one this install reads; a typo would
 * otherwise consent to nothing. Unreadable references leave the check open.
 */
function refuseUnknownConsentOrigins(
  consent: IssuerChangeConsent,
  served: readonly (ServedDeployment | undefined)[],
): void {
  if (served.some((deployment) => deployment === undefined)) return
  const origins = served.map((deployment) => deployment!.origin)
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
 * AM-81: an issuer consent sent after its install committed is refused, under a new operation id as
 * SCHEMA_INPUT_INVALID at `/domains/<i>/consent` (the Domain no longer changes issuer), under the
 * same id as SCHEMA_OPERATION_CONFLICT (a retry planned from the moved listing carries no consent).
 * Before such a refusal is reported, the installations are read back: when every reference is
 * installed from its URL with the pin read before the install, the install asked for holds, and
 * the command reports it as already current with the installed Domains as the Kernel describes them.
 */
async function committedEarlier(
  error: unknown,
  session: ClientSession,
  references: readonly string[],
  served: readonly (ServedDeployment | undefined)[],
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
  for (const [index, reference] of references.entries()) {
    const deployment = served[index]
    const installed = after.find((entry) => entry.origin === deployment?.origin)
    if (
      deployment === undefined ||
      installed === undefined ||
      !samePin(deployment.pin, installed.pin) ||
      installed.url !== new URL(reference).origin
    ) {
      return undefined
    }
    origins.push(deployment.origin)
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
    committedEarlier: refusal,
  })
}

type CurrentDomains = Extract<InstallResult, { readonly changed: false }>['domains']

function committedConsentRefusal(error: unknown): string | undefined {
  if (!(error instanceof ResponseError)) return undefined
  const code = reasonCode(error.reason)
  if (code === 'SCHEMA_OPERATION_CONFLICT') return code
  if (code !== 'SCHEMA_INPUT_INVALID') return undefined
  const details = (error.reason as { readonly details?: { readonly path?: unknown } }).details
  return typeof details?.path === 'string' && /^\/domains\/\d+\/consent$/u.test(details.path)
    ? code
    : undefined
}

function releaseUnsupported(): AstraleError {
  return new AstraleError(
    'KERNEL_RELEASE_UNSUPPORTED',
    'This Kernel does not list installed releases, so it takes no issuer consent: --allow-issuer-change and --revoke-previous are refused before any install.',
    'Install without them: on this Kernel the identity-override gate (--allow-identity-override) still applies. Issuer consent needs a Host release whose Kernel lists installed releases and accepts consents.',
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

function notYetActiveWindow(deps: Pick<UrlInstallDependencies, 'now' | 'sleep'>): RetryWindow {
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
  reference: string,
  retry: RetryWindow,
  deps: UrlInstallDependencies,
  machine: boolean,
): Promise<ServedDeployment | undefined> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await deps.readDeployment(reference, AbortSignal.timeout(10_000))
    } catch (error) {
      if (
        error instanceof DeploymentReadError &&
        error.retryable &&
        (await retry.wait(error.retryAfterMs, attempt))
      ) {
        continue
      }
      // The CLI only reads what the URL serves to guard and report the install; the Kernel reads it
      // again and stays the authority, so an unreadable document is installed without a digest.
      if (!machine) {
        log.warn(
          `Could not read what ${reference} serves (${error instanceof Error ? error.message : 'unreadable'}) — ` +
            'installing it without an expected release digest; the installed pin is reported after install.',
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

function refuseDuplicateOrigins(
  references: readonly string[],
  served: readonly (ServedDeployment | undefined)[],
): void {
  const byOrigin = new Map<string, string[]>()
  for (const [index, deployment] of served.entries()) {
    if (deployment === undefined) continue
    byOrigin.set(deployment.origin, [
      ...(byOrigin.get(deployment.origin) ?? []),
      references[index]!,
    ])
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

function releaseInstallRetry(
  references: readonly string[],
  operation: string,
  opts: UrlInstallOpts,
  changes: readonly (IssuerChange | undefined)[],
  overridden: readonly (string | undefined)[],
): string {
  const url = opts.url === undefined ? '' : ` --url ${opts.url}`
  const instance = opts.instance === undefined ? '' : ` -i ${opts.instance}`
  const identity = opts.as === undefined ? '' : ` --as ${opts.as}`
  // The same operation must carry the same consents: each change by its origin, never a prompt.
  const consents = changes
    .filter((change): change is IssuerChange => change !== undefined)
    .map((change) => ` --allow-issuer-change=${change.origin}`)
    .join('')
  const revoke = opts.revokePrevious === true ? ' --revoke-previous' : ''
  const override = overridden.some((origin) => origin !== undefined)
    ? ' --allow-identity-override'
    : ''
  return `astrale domain install ${references.join(' ')} --operation ${operation}${consents}${revoke}${override}${url}${instance}${identity}`
}

function pinMismatchError(mismatched: readonly InstallReference[]): AstraleError {
  const named = mismatched
    .map(
      (reference) => `${reference.origin} (read ${pinLabel(reference.pin!)} from ${reference.url})`,
    )
    .join(', ')
  return new AstraleError(
    'INSTALLED_PIN_MISMATCH',
    `The Kernel reports another installed release than the one read before the install: ${named}.`,
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
    // The listings only detail a replacement: the Kernel's result alone decides the status.
    const was =
      status === 'replaced' && reference.previous !== null
        ? chalk.dim(` (was ${pinLabel(reference.previous.pin)})`)
        : ''
    console.log(
      `  ${(reference.origin ?? reference.url).padEnd(width)}  ${status.padEnd(9)}  ${pin === null ? chalk.dim('pin not read') : pinLabel(pin)}${was}`,
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
