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
  credential: HostCredential,
) => OwnedConnection
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
    return resolveSourceCredential(target, options, hop.issuer, signal)
  }
  const source = await resolveSourceCredential(target, options, hop.resolver, signal)
  return delegateFromSource(source, hop.publication.identity.issuer, signal)
}

/** Open Host and source-Auth clients with the per-hop resolver bound once. */
function openConnection(
  target: ConnectionTarget,
  timeoutMs: number,
  options: ConnectionOptions,
): OwnedConnection {
  return createClientConnection(target, timeoutMs, {
    resolve: (hop, signal) => resolveHop(target, options, hop, signal),
  })
}

/** One terminal command-scoped connection lifecycle. */
export async function withHostSession<Value>(
  options: ConnectionOptions,
  action: (context: ConnectionContext) => Promise<Value>,
): Promise<Value> {
  const timeoutMs = resolveTimeoutMs(options.timeout)
  const target = await resolveTarget(options)
  const connection = openConnection(target, timeoutMs, options)
  try {
    return await action(connection.context)
  } finally {
    connection.close()
  }
}
