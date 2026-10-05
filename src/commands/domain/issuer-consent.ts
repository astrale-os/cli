import type { InstalledRelease } from '@astrale-os/sdk/client/schema'

import { parseDeploymentLabel } from '@astrale-os/sdk/deployment/address'
import chalk from 'chalk'

import type { ServedDeployment } from '../../lib/domain-release'

import { AstraleError } from '../../errors'
import { canPrompt, type PromptGate } from '../../lib/interactive'
import { log } from '../../lib/log'
import { dangerPanel } from '../../lib/panel'
import { confirmWithInput } from '../../lib/prompt'

/**
 * An issuer change is never silent (D7): the operator consents to it, and the Kernel records the
 * consent in the installation. A `same`-line change moves to another deployment of the line the
 * installed issuer belongs to, under the same routing domain; any other change, the move from a
 * legacy issuer to a first v4 deployment included, is `cross`-line (AM-19).
 */
export type IssuerChangeLine = 'same' | 'cross'

/** The issuer-change consent an install command was given. */
export interface IssuerChangeConsent {
  /** `--allow-issuer-change` without an origin: every same-line change of the install. */
  readonly sameLine: boolean
  /** `--allow-issuer-change=<origin>`: any change of these origins, same line or not. */
  readonly origins: readonly string[]
  /** `--revoke-previous`: cut the replaced issuer at the activation instead of draining it. */
  readonly revokePrevious: boolean
}

export const NO_ISSUER_CHANGE_CONSENT: IssuerChangeConsent = Object.freeze({
  sameLine: false,
  origins: Object.freeze([]),
  revokePrevious: false,
})

/**
 * The consent of the `--allow-issuer-change` occurrences (`''` for one written without an origin)
 * and `--revoke-previous`. An origin is a Domain origin as the installed listing names it, never a
 * URL.
 */
export function issuerChangeConsent(
  values: readonly string[] | undefined,
  revokePrevious: boolean | undefined,
): IssuerChangeConsent {
  const origins: string[] = []
  let sameLine = false
  for (const value of values ?? []) {
    if (value === '') {
      sameLine = true
      continue
    }
    if (!/^[^\s/:@]+$/u.test(value)) {
      throw new AstraleError(
        'INVALID_FLAG',
        `--allow-issuer-change=${value} does not name a Domain origin.`,
        'Name the origin whose issuer may change, for example --allow-issuer-change=crm.acme.dev',
      )
    }
    if (!origins.includes(value)) origins.push(value)
  }
  return Object.freeze({
    sameLine,
    origins: Object.freeze(origins),
    revokePrevious: revokePrevious === true,
  })
}

/** Whether the command asked for anything only an issuer-consenting Kernel can take. */
export function asksIssuerConsent(consent: IssuerChangeConsent): boolean {
  return consent.sameLine || consent.origins.length > 0 || consent.revokePrevious
}

/** The deployment line an address belongs to: its scheme, its routing domain and its line. */
export interface DeploymentLineAddress {
  readonly scheme: string
  readonly routingDomain: string
  readonly line: string
}

/**
 * The line of a deployment address `<scheme>://<line>-<content>.<routing domain>`, the URL and the
 * issuer of one immutable deployment (CT16); undefined for any other address, a legacy issuer such
 * as a stable Worker host included. The port is not part of the line: a routing domain is a DNS
 * name, and Services gives one author each line prefix under it.
 */
export function deploymentLineOf(address: string): DeploymentLineAddress | undefined {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined
  if (url.username !== '' || url.password !== '') return undefined
  const dot = url.hostname.indexOf('.')
  if (dot <= 0 || dot === url.hostname.length - 1) return undefined
  let line: string
  try {
    line = parseDeploymentLabel(url.hostname.slice(0, dot)).line
  } catch {
    return undefined
  }
  return Object.freeze({ scheme: url.protocol, routingDomain: url.hostname.slice(dot + 1), line })
}

/**
 * The line class of replacing the installed issuer `from` by the served issuer `to`, installed from
 * `url`: `same` only when the URL and the served issuer are both deployments of the installed
 * issuer's line, under its scheme and routing domain.
 */
export function issuerChangeLine(from: string, to: string, url: string): IssuerChangeLine {
  const installed = deploymentLineOf(from)
  if (installed === undefined) return 'cross'
  const onLine = (address: string): boolean => {
    const candidate = deploymentLineOf(address)
    return (
      candidate !== undefined &&
      candidate.scheme === installed.scheme &&
      candidate.routingDomain === installed.routingDomain &&
      candidate.line === installed.line
    )
  }
  return onLine(to) && onLine(new URL(url).origin) ? 'same' : 'cross'
}

/** One root whose installed issuer the install replaces, planned from the installed listing. */
export interface IssuerChange {
  readonly origin: string
  readonly reference: string
  readonly from: string
  readonly to: string
  readonly line: IssuerChangeLine
}

/** The issuer change installing `served` from `reference` makes, if the origin is installed under another issuer. */
export function plannedIssuerChange(
  reference: string,
  served: ServedDeployment,
  installed: readonly InstalledRelease[],
): IssuerChange | undefined {
  const current = installed.find((entry) => entry.origin === served.origin)
  if (current === undefined || current.issuer === served.issuer) return undefined
  return Object.freeze({
    origin: served.origin,
    reference,
    from: current.issuer,
    to: served.issuer,
    line: issuerChangeLine(current.issuer, served.issuer, reference),
  })
}

/** The consent one root of the install request carries (CT9): a compare-and-swap of the issuer. */
export interface IssuerConsentRequest {
  readonly issuer: { readonly from: string; readonly to: string }
  /** Omitted for the Kernel's default, `drain`. */
  readonly previous?: 'revoke'
}

export function issuerConsentRequest(
  change: IssuerChange,
  consent: IssuerChangeConsent,
): IssuerConsentRequest {
  return Object.freeze({
    issuer: Object.freeze({ from: change.from, to: change.to }),
    ...(consent.revokePrevious ? { previous: 'revoke' as const } : {}),
  })
}

/** Whether the flags consent: a same-line change by either form, any other only by its origin. */
export function consentedByFlags(change: IssuerChange, consent: IssuerChangeConsent): boolean {
  if (consent.origins.includes(change.origin)) return true
  return change.line === 'same' && consent.sameLine
}

/** One change ISSUER_CHANGE_NOT_CONSENTED names (CT24): the installed and the replacement issuer. */
export interface UnconsentedIssuerChange {
  readonly origin: string
  readonly installed: string
  readonly replacement: string
  readonly line: IssuerChangeLine
}

/**
 * The issuer changes of one install that neither a flag nor the operator's confirmation consented
 * to, all of them at once (CT24 `details.origins`), refused before any install is sent.
 */
export class IssuerChangeNotConsentedError extends AstraleError {
  constructor(changes: readonly [IssuerChange, ...IssuerChange[]]) {
    const [first] = changes
    const kind = (change: IssuerChange) =>
      change.line === 'same' ? 'a new deployment of the same line' : 'another line'
    const flags = [
      ...(changes.some((change) => change.line === 'same') ? ['--allow-issuer-change'] : []),
      ...changes
        .filter((change) => change.line === 'cross')
        .map((change) => `--allow-issuer-change=${change.origin}`),
    ]
    super(
      'ISSUER_CHANGE_NOT_CONSENTED',
      changes.length === 1
        ? `Installing ${first.reference} changes the issuer of ${first.origin} from ${first.from} ` +
            `to ${first.to} (${kind(first)}), and no consent was given.`
        : `This install changes the issuer of ${changes.length} Domains without consent: ` +
            changes
              .map((change) => `${change.origin} ${change.from} -> ${change.to} (${kind(change)})`)
              .join('; ') +
            '.',
      `Pass ${flags.join(' ')}, or run interactively to confirm` +
        (changes.some((change) => change.line === 'cross')
          ? '; --allow-issuer-change alone covers only a new deployment of the same line.'
          : '.'),
    )
    this.details = Object.freeze({
      origins: Object.freeze(
        changes.map((change): UnconsentedIssuerChange =>
          Object.freeze({
            origin: change.origin,
            installed: change.from,
            replacement: change.to,
            line: change.line,
          }),
        ),
      ),
    })
  }
}

/**
 * Admit every planned issuer change of one install: first by the flags, then, for the rest, by
 * the operator typing each origin at a terminal. Nothing is asked without one, nor in machine
 * mode or when the command's `gate` opts out of prompts (--ci, --no-prompt, or their programmatic
 * options). Whatever stays unconsented, the declined change and every change not asked yet, is
 * refused in one error before any install is sent.
 */
export async function admitIssuerChanges(
  changes: readonly IssuerChange[],
  consent: IssuerChangeConsent,
  machine: boolean,
  gate: PromptGate = {},
  confirm: (
    banner: string,
    expected: string,
    gate: PromptGate,
  ) => Promise<boolean> = confirmWithInput,
): Promise<void> {
  const unconsented: IssuerChange[] = []
  for (const change of changes) {
    if (!consentedByFlags(change, consent)) {
      unconsented.push(change)
    } else if (!machine) {
      log.warn(
        `Issuer change consented via --allow-issuer-change: ${change.origin} ${change.from} -> ${change.to}`,
      )
    }
  }
  const [first] = unconsented
  if (first !== undefined && (machine || !canPrompt(gate))) {
    throw new IssuerChangeNotConsentedError([first, ...unconsented.slice(1)])
  }
  for (const [index, change] of unconsented.entries()) {
    if (!(await confirm(issuerChangeBanner(change, consent), change.origin, gate))) {
      throw new IssuerChangeNotConsentedError(
        unconsented.slice(index) as [IssuerChange, ...IssuerChange[]],
      )
    }
  }
}

function issuerChangeBanner(change: IssuerChange, consent: IssuerChangeConsent): string {
  return dangerPanel('ISSUER CHANGE', [
    `origin     ${chalk.bold(change.origin)}`,
    `installed  ${change.from}`,
    `new        ${change.to}   ${chalk.red(change.line === 'same' ? '(same line)' : '(another line)')}`,
    '',
    `Calls signed by ${change.to} will act as ${change.origin} on this instance.`,
    consent.revokePrevious
      ? `${change.from} is cut at the activation (--revoke-previous).`
      : `${change.from} stays accepted while its in-flight work drains.`,
  ])
}

/**
 * AM-19: the explicit reference to a deployment that serves a `DomainRelease` authorizes the first
 * install of its origin; the CLI says so when the origin is not the host serving it, without asking.
 */
export function firstInstallNotice(
  served: ServedDeployment,
  reference: string,
): string | undefined {
  if (served.pin.kind !== 'release') return undefined
  const url = new URL(reference)
  if (served.origin.toLowerCase() === url.hostname.toLowerCase()) return undefined
  return `origin ${served.origin} claimed by unverified deployment ${url.origin}`
}
