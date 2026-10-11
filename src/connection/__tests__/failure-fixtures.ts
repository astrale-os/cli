import { SessionError, TransportError, type TransportContext } from '@astrale-os/sdk/client'

export function transportFailure(
  message: string,
  phase: TransportError['phase'],
  context: TransportContext,
): TransportError {
  return context.kind === 'acquisition'
    ? TransportError.acquisition(message, { phase, resource: context.resource })
    : TransportError.invocation(message, {
        phase,
        delivery: context.delivery,
        ...(context.invocation === undefined ? {} : { invocation: context.invocation }),
      })
}

export function sessionFailure(
  message: string,
  failure: 'cancelled' | 'closed' | 'timeout',
): SessionError {
  return new SessionError(message, { failure })
}
