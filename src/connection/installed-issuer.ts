import type { IssuerId } from '@astrale-os/sdk/auth'
import type { DomainInfo } from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'

import { issuer } from '@astrale-os/sdk/auth'
import { ResponseError } from '@astrale-os/sdk/client'

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
 * Kernel refusals of the installation read itself: the Domain is absent or not ready (1003
 * VALIDATION_ERROR with a SCHEMA_NOT_FOUND or SCHEMA_NOT_READY reason), the caller may not read it
 * (2004), or the Kernel does not serve the read (3001, 3002). Any other refusal, such as an
 * invalid or expired source login or an unavailable backend, is not about the installation.
 */
const INSTALLATION_READ_REFUSALS: ReadonlySet<number> = new Set([1003, 2004, 3001, 3002])

/**
 * The issuer at which the CLI exchanges for the Domain installed under one origin on one Kernel.
 *
 * The Kernel pin names it, read through the Session that already authenticates the selected
 * identity for the exchange, once per session; nothing derives it from a route. It is held for this
 * session only: a reinstall from an immutable deployment changes it, so the installation cache,
 * which records only facts fixed for the life of an installation, never holds it, and a persisted
 * Domain credential is selected only under an issuer this session read. An exchange that fails as a
 * moved issuer would makes the session read the pin once more.
 */
export function createInstalledIssuer(
  kernelIssuer: IssuerId,
  origin: string,
  read: InstalledDomainReader = inspectInstalledDomain,
): ExchangeIssuer {
  /** What the pin named when this session read it; null for a Domain hosted by the Kernel. */
  let pinned: IssuerId | null | undefined

  return Object.freeze({
    async known() {
      return pinned ?? undefined
    },
    async current(session: () => ClientSession, signal: AbortSignal) {
      if (pinned === undefined) {
        pinned = await installedIssuer(kernelIssuer, origin, read, session(), signal)
      }
      return pinned
    },
    async moved(failed: IssuerId, session: () => ClientSession, signal: AbortSignal) {
      let next: IssuerId | null
      try {
        next = await installedIssuer(kernelIssuer, origin, read, session(), signal)
      } catch (cause) {
        // A pin that cannot be read again explains nothing: the exchange failure and this
        // session's read stand.
        if (signal.aborted) throw cause
        return undefined
      }
      if (next === failed) return undefined
      pinned = next
      return next
    },
  })
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
  if (cause instanceof ResponseError) return INSTALLATION_READ_REFUSALS.has(cause.code)
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
