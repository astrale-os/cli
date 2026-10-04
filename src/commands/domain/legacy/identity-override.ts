/**
 * The identity-override gate: consent to a Domain whose declared origin differs from the host that
 * serves it, read from its legacy v2/v3 Publication (`domain.json`).
 *
 * @deprecated Successor: the issuer consent of `../issuer-consent.ts` (D7) and the non-blocking
 * first-install notice (AM-19). Every deployment URL that serves a `DomainRelease` v4 differs from
 * its origin by design, so the gate does not apply to it: the explicit reference authorizes a first
 * install, and an issuer change needs the operator's consent. The gate runs only for sources that
 * serve `domain.json` alone and for every URL install on a Kernel without the `installed` listing.
 * Short-term consumers: 1Pact developer machines, whose sdk 0.6.0-beta.0 `reconcile` execs
 * `domain install <url> --direct --allow-identity-override -i <instance>` against the beta.117
 * Host; consented rollbacks to the legacy shell-v3 / services-v2 URLs, whose origin is not their
 * host. Removal (D15): once no supported Kernel lacks the `installed` listing and no install
 * source serves only `domain.json`, in a breaking CLI release with `--allow-identity-override`.
 */
import chalk from 'chalk'

import { AstraleError } from '../../../errors'
import { fetchDomainPublication } from '../../../lib/domain-publication'
import { log } from '../../../lib/log'
import { dangerPanel } from '../../../lib/panel'
import { confirmWithInput } from '../../../lib/prompt'

/** An override = the declared origin and the serving host name differ. */
export function isIdentityOverride(origin: string, host: string): boolean {
  return origin.toLowerCase() !== host.toLowerCase()
}

/**
 * The §5 identity-override gate (spec: CREATE_ASTRALE_DOMAIN_DX), reading the declared origin from
 * the worker's canonical Publication (`domain.json`) itself. A domain's `origin` is its addressing
 * identity on the instance: every `<origin>/*` call — including other domains' `requires` — routes
 * to the installed URL. Claiming an origin that differs from the serving host is an explicit actAs
 * and needs typed consent (or `--allow-identity-override` in scripts).
 *
 * The pre-install check is consent UX, not enforcement — a hostile worker can lie here, and the
 * kernel anchors the cryptographic identity (`iss`) on the real URL regardless. When the
 * Publication is unreachable or invalid, the gate degrades to a warning and the kernel-confirmed
 * origin is re-checked after install.
 *
 * Returns the origin the user consented to (or `undefined` when no override was detected /
 * verifiable pre-install).
 */
export async function ensureIdentityOverrideConsent(
  url: string,
  host: string,
  allow: boolean,
  machine: boolean,
): Promise<string | undefined> {
  const origin = await probeDeclaredOrigin(url)
  if (origin === undefined) {
    if (!machine) {
      log.warn(
        `Could not read a declared origin from ` +
          `${new URL('/.well-known/astrale/domain.json', url).href} — ` +
          `skipping the pre-install identity check (the installed origin is verified after install).`,
      )
    }
    return undefined
  }
  return consentToDeclaredOrigin(origin, host, allow, machine)
}

/**
 * The same gate for an origin the caller already read from what the URL serves. Returns the
 * consented origin, or `undefined` when the origin is the serving host.
 */
export async function consentToDeclaredOrigin(
  origin: string,
  host: string,
  allow: boolean,
  machine: boolean,
): Promise<string | undefined> {
  if (!isIdentityOverride(origin, host)) return undefined

  if (allow) {
    if (!machine) {
      log.warn(`Identity override consented via --allow-identity-override: ${origin} ← ${host}`)
    }
    return origin
  }

  const banner = dangerPanel('IDENTITY OVERRIDE', [
    `deployed   ${host}`,
    `origin     ${chalk.bold(origin)}   ${chalk.red('(≠)')}`,
    '',
    `Every call to ${origin}/* on this instance —`,
    `including from other domains — will hit ${host}.`,
    `Only proceed if you trust ${host}.`,
  ])
  const confirmed = await confirmWithInput(banner, origin)
  if (!confirmed) {
    throw new AstraleError(
      'IDENTITY_OVERRIDE_REJECTED',
      `Install aborted: the domain at ${host} declares origin "${origin}" (identity override) and it was not confirmed.`,
      'Re-run interactively and type the origin to confirm, or pass --allow-identity-override in scripts.',
    )
  }
  return origin
}

/** Best-effort read of the worker's origin from its admitted canonical Publication. */
export async function probeDeclaredOrigin(url: string): Promise<string | undefined> {
  try {
    return (await fetchDomainPublication(url, AbortSignal.timeout(10_000))).origin
  } catch {
    // An unreachable or invalid Publication is not fatal here: the caller warns
    // and the install itself will surface a dead worker with its own error.
    return undefined
  }
}

/**
 * After install, the Kernel-confirmed origin is authoritative. If it aliases the host and the
 * pre-install gate never consented to THAT origin (lying or unavailable Publication), say so.
 */
export function warnUnconfirmedOverride(
  installedOrigin: string,
  host: string,
  consentedOrigin: string | undefined,
  machine: boolean,
): void {
  if (machine) return
  if (!isIdentityOverride(installedOrigin, host) || installedOrigin === consentedOrigin) return
  log.warn(
    `Installed origin "${installedOrigin}" differs from the serving host "${host}" ` +
      `and was not confirmed before install (the worker Publication was unavailable). ` +
      `Every ${installedOrigin}/* call on this instance now routes to ${host}.`,
  )
}
