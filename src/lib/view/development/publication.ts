import type { ResolvedView, ViewTransport } from '@astrale-os/shell'

import { AstraleError } from '../../../errors'
import { fetchDomainPublication } from '../../domain-publication'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * Prove that one loopback Worker serves the exact Publication from which the
 * Kernel resolved `view`, then return the narrow physical transport witness.
 */
export async function proveDevelopmentViewTransport(
  view: ResolvedView,
  input: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<ViewTransport> {
  const localOrigin = developmentLocalOrigin(input)
  const deployed = await fetchDomainPublication(localOrigin, signal, fetchImpl)
  const route = view.route
  const viewOrigin = originFromViewKey(String(route.key))
  const binding = deployed.bindings.views.find((candidate) => candidate.view === route.key)

  if (
    deployed.origin !== viewOrigin ||
    deployed.identity.issuer !== route.issuer ||
    deployed.identity.subject !== viewOrigin ||
    deployed.schema.revision !== route.revision ||
    deployed.etag !== route.etag ||
    binding?.href !== route.href ||
    binding?.handshake !== route.handshake
  ) {
    throw new AstraleError(
      'VIEW_DEVELOPMENT_MISMATCH',
      'The local Domain Publication does not match the Kernel-resolved View placement.',
      'Wait for development reconciliation to converge, then reopen the View.',
    )
  }

  const publicDocument = new URL(route.href)
  return Object.freeze({
    href: localDocument(localOrigin, publicDocument),
    issuer: route.issuer,
    revision: route.revision,
    etag: route.etag,
  })
}

/** Require one literal loopback HTTP(S) origin, never an alternate View path. */
export function developmentLocalOrigin(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch (cause) {
    throw invalidDevelopmentUrl(input, cause)
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    !isLiteralLoopback(url.hostname)
  ) {
    throw invalidDevelopmentUrl(input)
  }
  return url.origin
}

function originFromViewKey(key: string): string {
  const marker = ':view.'
  const boundary = key.lastIndexOf(marker)
  return boundary <= 0 ? '' : key.slice(0, boundary)
}

function localDocument(localOrigin: string, publicDocument: URL): string {
  return new URL(
    `${publicDocument.pathname}${publicDocument.search}${publicDocument.hash}`,
    localOrigin,
  ).href
}

function isLiteralLoopback(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const octets = hostname.split('.').map(Number)
  return (
    octets.length === 4 &&
    octets[0] === 127 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
  )
}

function invalidDevelopmentUrl(input: string, cause?: unknown): AstraleError {
  return new AstraleError(
    'INVALID_ARGUMENT',
    `Development local URL must be a literal loopback HTTP(S) origin: ${input}`,
    undefined,
    cause === undefined ? undefined : { cause },
  )
}
