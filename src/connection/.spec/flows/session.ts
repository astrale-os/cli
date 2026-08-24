import type { Call } from '@astrale-os/sdk/client'
import type { SessionAuth } from '@astrale-os/sdk/client/session'

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
  auth: SessionAuth | undefined,
) => OwnedConnection
declare const validateCredentialSelection: (options: ConnectionOptions) => void
declare const resolveSourceCredential: (
  target: ConnectionTarget,
  options: ConnectionOptions,
  audience: string,
  signal: AbortSignal,
) => Promise<string>
/** Bind source authority without learning or minting destination credentials. */
function createConnectionAuth(target: ConnectionTarget, options: ConnectionOptions): SessionAuth {
  return {
    ttlSeconds: 3_600,
    async resolve(_call: Call, signal: AbortSignal) {
      return {
        credential: await resolveSourceCredential(target, options, target.issuer, signal),
      }
    },
  }
}

/** Open one Client Session with a call-scoped source-authority resolver bound once. */
function openConnection(
  target: ConnectionTarget,
  timeoutMs: number,
  options: ConnectionOptions,
): OwnedConnection {
  const auth = options.anonymous === true ? undefined : createConnectionAuth(target, options)
  return createClientConnection(target, timeoutMs, auth)
}

/** One terminal command-scoped connection lifecycle. */
export async function withClientSession<Value>(
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
