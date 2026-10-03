import type { IssuerId } from '@astrale-os/sdk/auth'
import type { DomainInfo } from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'

import { issuer } from '@astrale-os/sdk/auth'
import { ResponseError } from '@astrale-os/sdk/client'

import type { InstallationCache } from '../state/installations'
import type { ExchangeIssuer } from './exchange'

import { AstraleError } from '../errors'

/** Read the installed Domain of one origin through an authenticated source Session. */
export type InstalledDomainReader = (
  session: ClientSession,
  origin: string,
  signal: AbortSignal,
) => Promise<Pick<DomainInfo, 'publication'>>

const inspectInstalledDomain: InstalledDomainReader = (session, origin, signal) =>
  session.schema.inspect(origin, { signal })

/**
 * Kernel refusals of the installation read itself: the caller may not read it (2004), or the
 * Kernel does not serve the read (3001, 3002). Any other refusal, such as an invalid or expired
 * source login or an unavailable backend, is not about the installation.
 */
const INSTALLATION_READ_REFUSALS: ReadonlySet<number> = new Set([2004, 3001, 3002])

/** The 1003 VALIDATION_ERROR reasons that say the Domain is absent or not ready. */
const INSTALLATION_ABSENCE_REASONS: ReadonlySet<string> = new Set([
  'SCHEMA_NOT_FOUND',
  'SCHEMA_NOT_READY',
])

/** Where a target that names an installed Domain by origin exchanges, across commands. */
export interface InstalledIssuer extends ExchangeIssuer {
  /**
   * The command this issuer served failed, or the Kernel refused (2002) a credential it served,
   * even one the command recovered from. An issuer it served from the installation cache, not from
   * a pin it read, is forgotten, so the next command reads the pin and never relies on it again.
   */
  failed(): Promise<void>
}

/**
 * The issuer at which the CLI exchanges for the Domain installed under one origin on one Kernel.
 *
 * The Kernel pin names it, read through the Session that already authenticates the selected
 * identity for the exchange; nothing derives it from a route. The installation cache remembers what
 * the pin named, so later commands exchange, or select a persisted Domain credential, without
 * reading it again. A consented reinstall changes the issuer within one installation, so the record
 * is healed rather than trusted: an exchange that fails as a moved issuer would reads the pin once
 * more, and a command that relied on the record and failed forgets it.
 */
export function createInstalledIssuer(
  kernelIssuer: IssuerId,
  origin: string,
  installations?: InstallationCache,
  read: InstalledDomainReader = inspectInstalledDomain,
): InstalledIssuer {
  /** The issuer this session exchanges at; null for a Domain hosted by the Kernel. */
  let held: IssuerId | null | undefined
  /** Whether `held` came from the installation cache rather than from a pin this session read. */
  let remembered = false
  let recalled: Promise<IssuerId | null | undefined> | undefined

  async function hold(): Promise<IssuerId | null | undefined> {
    if (held !== undefined) return held
    const recorded = await (recalled ??= recall(installations, kernelIssuer, origin))
    if (held === undefined && recorded !== undefined) {
      held = recorded
      remembered = true
    }
    return held
  }

  async function readPin(session: ClientSession, signal: AbortSignal): Promise<IssuerId | null> {
    const pinned = await installedIssuer(kernelIssuer, origin, read, session, signal)
    held = pinned
    remembered = false
    // A record that cannot be written only costs the next command one more read.
    await installations?.set(kernelIssuer, origin, { issuer: pinned }).catch(() => undefined)
    return pinned
  }

  return Object.freeze({
    async known() {
      return (await hold()) ?? undefined
    },
    async current(session: () => ClientSession, signal: AbortSignal) {
      const known = await hold()
      return known === undefined ? readPin(session(), signal) : known
    },
    async moved(failed: IssuerId, session: () => ClientSession, signal: AbortSignal) {
      let next: IssuerId | null
      try {
        next = await readPin(session(), signal)
      } catch (cause) {
        // A pin that cannot be read again explains nothing: the exchange failure and what this
        // session holds stand.
        if (signal.aborted) throw cause
        return undefined
      }
      return next === failed ? undefined : next
    },
    async failed() {
      if (!remembered) return
      remembered = false
      await installations?.delete(kernelIssuer, origin).catch(() => undefined)
    },
  })
}

/** What the installation cache remembers the pin named; an unusable cache is a miss. */
async function recall(
  installations: InstallationCache | undefined,
  kernelIssuer: IssuerId,
  origin: string,
): Promise<IssuerId | null | undefined> {
  try {
    const installation = await installations?.get(kernelIssuer, origin)
    if (installation === undefined) return undefined
    if (installation.issuer === null) return null
    const accepted = issuer.accept(installation.issuer)
    return accepted === kernelIssuer ? null : accepted
  } catch {
    return undefined
  }
}

async function installedIssuer(
  kernelIssuer: IssuerId,
  origin: string,
  read: InstalledDomainReader,
  session: ClientSession,
  signal: AbortSignal,
): Promise<IssuerId | null> {
  try {
    const pinned = (await read(session, origin, signal)).publication?.identity.issuer
    if (pinned === undefined) return null
    const accepted = issuer.accept(pinned)
    return accepted === kernelIssuer ? null : accepted
  } catch (cause) {
    // Transport, session and Kernel authentication or capacity failures keep their own identity,
    // exactly as the source caller's first Kernel call would report them.
    if (signal.aborted || !aboutInstallation(cause)) throw cause
    throw new AstraleError(
      'TOKEN_EXCHANGE_ISSUER_UNRESOLVED',
      `The issuer of the installed ${origin} Domain could not be read from ${kernelIssuer}.`,
      readFailure(cause),
      { cause },
    )
  }
}

/** Whether a failed read says something about the installation rather than the way to reach it. */
function aboutInstallation(cause: unknown): boolean {
  if (cause instanceof ResponseError) {
    // Any other 1003 rejects the read's own input, which names a constant origin.
    if (cause.code === 1003) return INSTALLATION_ABSENCE_REASONS.has(cause.reason?.code ?? '')
    return INSTALLATION_READ_REFUSALS.has(cause.code)
  }
  // Decoders and `issuer.accept` (AuthValueError) report invalid evidence as TypeError.
  return cause instanceof TypeError
}

/** Name why the pin could not be read without echoing a native failure's private message. */
function readFailure(cause: unknown): string {
  if (cause instanceof ResponseError) {
    const reason = cause.reason === undefined ? '' : ` (${cause.reason.code})`
    return `The Kernel refused the installation read with ${cause.code}${reason}: ${cause.message}`
  }
  return `The installation read returned an invalid Domain: ${(cause as TypeError).message}`
}
