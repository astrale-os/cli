import {
  ClientError,
  ProtocolError,
  ResponseError,
  SessionError,
  TransportError,
} from '@astrale-os/kernel-client'
import { NodeUnavailableError } from '@astrale-os/kernel-client/graph'
import { AuthValueError } from '@astrale-os/sdk/auth'
import { PathError } from '@astrale-os/sdk/graph/path'

import type { FailureDiagnostic } from './model'

import { AstraleError } from '../../errors'

export function classifyFailure(error: unknown): FailureDiagnostic {
  if (error instanceof AstraleError) return simple(error.code, error.message, error.hint)
  if (error instanceof TransportError) {
    return {
      kind: 'transport',
      code: lifecycleCode(error.phase),
      message: error.message,
      phase: error.phase,
      context: error.context,
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
  if (error instanceof SessionError) return simple(lifecycleCode(error.failure), error.message)
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

function lifecycleCode(value: TransportError['phase']): TransportCode
function lifecycleCode(value: SessionError['failure']): string
function lifecycleCode(value: TransportError['phase'] | SessionError['failure']): string {
  if (value === 'connect') return 'CONNECTION_ERROR'
  if (value === 'timeout') return 'TIMEOUT'
  if (value === 'closed') return 'DISCONNECTED'
  return value === 'cancelled' ? 'CANCELLED' : 'TRANSPORT_ERROR'
}

const simple = (code: string, message: string, hint?: string): FailureDiagnostic => ({
  kind: 'simple',
  code,
  message,
  ...(hint === undefined ? {} : { hint }),
})
