import type { IssuerId } from '@astrale-os/sdk/auth'
import type { DomainInfo } from '@astrale-os/sdk/client/schema'
import type { ClientSession } from '@astrale-os/sdk/client/session'

import { issuer } from '@astrale-os/sdk/auth'
import { ClientError, ResponseError } from '@astrale-os/sdk/client'

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
 * The issuer at which the CLI exchanges for the Domain installed under one origin on one Kernel.
 *
 * The Kernel pin names it, read through the Session that already authenticates the selected
 * identity for the exchange, once per session; nothing derives it from a route. The remembered
 * issuer only selects a credential an earlier command exchanged: every fresh exchange uses an
 * issuer read in this session, and an exchange that fails as a moved issuer would makes the
 * session read the pin once more.
 */
export function createInstalledIssuer(
  kernelIssuer: IssuerId,
  origin: string,
  installations?: InstallationCache,
  read: InstalledDomainReader = inspectInstalledDomain,
): ExchangeIssuer {
  /** What the pin named when this session read it; null for a Domain hosted by the Kernel. */
  let pinned: IssuerId | null | undefined

  async function readPin(session: () => ClientSession, signal: AbortSignal) {
    pinned = await installedIssuer(kernelIssuer, origin, read, session(), signal)
    await installations?.set(kernelIssuer, origin, { issuer: pinned }).catch(() => undefined)
    return pinned
  }

  return Object.freeze({
    async known() {
      if (pinned !== undefined) return pinned ?? undefined
      const remembered = await installations?.get(kernelIssuer, origin).catch(() => undefined)
      return typeof remembered?.issuer === 'string' ? issuer.accept(remembered.issuer) : undefined
    },
    async current(session: () => ClientSession, signal: AbortSignal) {
      return pinned !== undefined ? pinned : readPin(session, signal)
    },
    async moved(failed: IssuerId, session: () => ClientSession, signal: AbortSignal) {
      pinned = undefined
      await installations?.delete(kernelIssuer, origin).catch(() => undefined)
      const next = await readPin(session, signal)
      return next === failed ? undefined : next
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
    if (signal.aborted) throw cause
    throw new AstraleError(
      'TOKEN_EXCHANGE_ISSUER_UNRESOLVED',
      `The issuer of the installed ${origin} Domain could not be read from ${kernelIssuer}.`,
      readFailure(cause),
      { cause },
    )
  }
}

/** Name why the pin could not be read without echoing a native failure's private message. */
function readFailure(cause: unknown): string {
  if (cause instanceof ResponseError) {
    return `The Kernel refused the installation read with ${cause.code}: ${cause.message}`
  }
  if (cause instanceof ClientError) return cause.message
  // Decoders and `issuer.accept` (AuthValueError) report invalid evidence as TypeError.
  return cause instanceof TypeError
    ? `The installation read returned an invalid Domain: ${cause.message}`
    : 'The installation read failed unexpectedly; re-run with --debug for its cause.'
}
