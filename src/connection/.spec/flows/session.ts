import type { HostCredential, HostHop } from '@astrale-os/kernel-client/host'

import type { ConnectionContext, ConnectionOptions, ConnectionTarget } from '../api.js'

interface OwnedConnection {
  readonly context: ConnectionContext
  close(): void
}

declare const resolveTarget: (options: ConnectionOptions) => Promise<ConnectionTarget>
declare const resolveTimeoutMs: (input: string | undefined) => number
declare const createClientConnection: (
  target: ConnectionTarget,
  timeoutMs: number,
  credential: HostCredential | undefined,
) => OwnedConnection
declare const validateCredentialSelection: (options: ConnectionOptions) => void
declare const resolveSourceCredential: (
  target: ConnectionTarget,
  options: ConnectionOptions,
  audience: string,
  signal: AbortSignal,
) => Promise<string>
declare const delegateFromSource: (
  sourceCredential: string,
  audience: string,
  signal: AbortSignal,
) => Promise<string>

/** Resolve a credential for exactly the admitted hop; no credential crosses audiences unchanged. */
async function resolveHop(
  target: ConnectionTarget,
  options: ConnectionOptions,
  hop: HostHop,
  signal: AbortSignal,
): Promise<string> {
  if (hop.kind === 'source') {
    requireSelectedIssuer(target.issuer, hop.issuer)
    return resolveSourceCredential(target, options, target.issuer, signal)
  }
  requireSelectedIssuer(target.issuer, hop.resolver)
  const audience = hop.publication.identity.issuer
  const source = await resolveSourceCredential(target, options, target.issuer, signal)
  return delegateFromSource(source, audience, signal)
}

declare const requireSelectedIssuer: (expected: string, actual: string) => void

/** Open Host and source-Auth clients with the per-hop resolver bound once. */
function openConnection(
  target: ConnectionTarget,
  timeoutMs: number,
  options: ConnectionOptions,
): OwnedConnection {
  const credential =
    options.anonymous === true
      ? undefined
      : { resolve: (hop: HostHop, signal: AbortSignal) => resolveHop(target, options, hop, signal) }
  return createClientConnection(target, timeoutMs, credential)
}

/** One terminal command-scoped connection lifecycle. */
export async function withHostSession<Value>(
  options: ConnectionOptions,
  action: (context: ConnectionContext) => Promise<Value>,
): Promise<Value> {
  validateCredentialSelection(options)
  const timeoutMs = resolveTimeoutMs(options.timeout)
  const target = await resolveTarget(options)
  const connection = openConnection(target, timeoutMs, options)
  try {
    return await action(connection.context)
  } finally {
    connection.close()
  }
}
