import { SessionError, TransportError } from '@astrale-os/sdk/client'

import type { TransportDiagnosticContext } from '../failure/model'

export function transportFailure(
  message: string,
  phase: TransportError['phase'],
  context: TransportDiagnosticContext,
): TransportError {
  return context.kind === 'acquisition'
    ? TransportError.acquisition(message, { phase, resource: context.resource })
    : TransportError.invocation(message, {
        phase,
        delivery: context.delivery,
        ...(context.invocation === undefined
          ? {}
          : {
              invocation: context.invocation as Parameters<
                typeof TransportError.invocation
              >[1]['invocation'],
            }),
      })
}

export function sessionFailure(
  message: string,
  failure: 'cancelled' | 'closed' | 'timeout',
): SessionError {
  return new SessionError(message, { failure })
}
