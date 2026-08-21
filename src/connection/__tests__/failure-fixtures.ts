import { ClientError, TransportError } from '@astrale-os/kernel-client'

import type { TransportDiagnosticContext } from '../failure/model'

type CompatibleTransportPhase = TransportError['phase'] | 'unknown'

export function transportFailure(
  message: string,
  phase: CompatibleTransportPhase,
  context: TransportDiagnosticContext,
): TransportError {
  const error = new Error(message) as TransportError & {
    context: TransportDiagnosticContext
  }
  Object.setPrototypeOf(error, TransportError.prototype)
  Object.assign(error, { name: 'TransportError', phase, context })
  return error
}

export function legacyTransportFailure(
  message: string,
  phase: CompatibleTransportPhase,
  delivery: 'not-sent' | 'unknown',
): TransportError {
  const error = new Error(message) as TransportError & { delivery: typeof delivery }
  Object.setPrototypeOf(error, TransportError.prototype)
  Object.assign(error, { name: 'TransportError', phase, delivery })
  return error
}

export function sessionFailure(
  message: string,
  failure: 'cancelled' | 'closed' | 'timeout',
): ClientError {
  const error = new Error(message) as ClientError & { failure: typeof failure }
  Object.setPrototypeOf(error, ClientError.prototype)
  Object.assign(error, { name: 'SessionError', failure })
  return error
}
