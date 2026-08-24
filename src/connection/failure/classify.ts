import { AuthValueError } from '@astrale-os/sdk/auth'
import { ClientError, ProtocolError, ResponseError, TransportError } from '@astrale-os/sdk/client'
import { NodeUnavailableError } from '@astrale-os/sdk/client'
import { PathError } from '@astrale-os/sdk/graph/path'

import type { FailureDiagnostic, TransportDiagnosticContext } from './model'

import { AstraleError } from '../../errors'

export function classifyFailure(error: unknown): FailureDiagnostic {
  if (error instanceof AstraleError) return simple(error.code, error.message, error.hint)
  if (error instanceof TransportError) {
    const context = transportContext(error)
    if (context === undefined) return simple('TRANSPORT_ERROR', error.message)
    return {
      kind: 'transport',
      code: lifecycleCode(error.phase),
      message: error.message,
      phase: error.phase,
      context,
    }
  }
  if (error instanceof ResponseError) {
    return {
      kind: 'response',
      code: error.code,
      message: error.message,
      ...(error.reason === undefined ? {} : { reason: error.reason }),
    }
  }
  if (error instanceof ClientError) {
    const failure = sessionFailure(error)
    if (failure !== undefined) return simple(lifecycleCode(failure), error.message)
  }
  if (error instanceof ProtocolError) return simple('PROTOCOL_ERROR', error.message)
  if (error instanceof NodeUnavailableError)
    return simple(
      'NODE_UNAVAILABLE',
      error.message,
      'If this is a callable Path, use `astrale call` or `astrale introspect`.',
    )
  if (error instanceof PathError) return simple('PATH_INVALID', error.message)
  if (error instanceof AuthValueError) return simple('AUTH_VALUE_INVALID', error.message)
  if (error instanceof ClientError) return simple('CLIENT_ERROR', error.message)
  return simple('UNEXPECTED_ERROR', 'The CLI encountered an unexpected internal failure.')
}

type TransportCode = Extract<FailureDiagnostic, { kind: 'transport' }>['code']
type SessionFailure = 'cancelled' | 'closed' | 'timeout'

function lifecycleCode(value: TransportError['phase']): TransportCode
function lifecycleCode(value: SessionFailure): string
function lifecycleCode(value: TransportError['phase'] | SessionFailure): string {
  if (value === 'connect') return 'CONNECTION_ERROR'
  if (value === 'timeout') return 'TIMEOUT'
  if (value === 'closed') return 'DISCONNECTED'
  return value === 'cancelled' ? 'CANCELLED' : 'TRANSPORT_ERROR'
}

function transportContext(error: TransportError): TransportDiagnosticContext | undefined {
  const evidence = error as TransportError & {
    readonly context?: unknown
    readonly delivery?: unknown
    readonly invocation?: unknown
  }
  if (record(evidence.context)) {
    if (
      evidence.context.kind === 'acquisition' &&
      (evidence.context.resource === 'publication' || evidence.context.resource === 'bundle')
    ) {
      return { kind: 'acquisition', resource: evidence.context.resource }
    }
    if (
      evidence.context.kind === 'invocation' &&
      (evidence.context.delivery === 'not-sent' || evidence.context.delivery === 'unknown')
    ) {
      return {
        kind: 'invocation',
        delivery: evidence.context.delivery,
        ...(evidence.context.invocation === undefined
          ? {}
          : { invocation: evidence.context.invocation }),
      }
    }
  }
  if (evidence.delivery !== 'not-sent' && evidence.delivery !== 'unknown') return undefined
  return {
    kind: 'invocation',
    delivery: evidence.delivery,
    ...(evidence.invocation === undefined ? {} : { invocation: evidence.invocation }),
  }
}

function sessionFailure(error: ClientError): SessionFailure | undefined {
  const failure = (error as ClientError & { readonly failure?: unknown }).failure
  return failure === 'cancelled' || failure === 'closed' || failure === 'timeout'
    ? failure
    : undefined
}

function record(input: unknown): input is Readonly<Record<string, unknown>> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
}

const simple = (code: string, message: string, hint?: string): FailureDiagnostic => ({
  kind: 'simple',
  code,
  message,
  ...(hint === undefined ? {} : { hint }),
})
