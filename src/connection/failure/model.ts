import type { TransportContext, TransportError } from '@astrale-os/sdk/client'

export type FailureDiagnostic =
  | {
      readonly kind: 'simple'
      readonly code: string
      readonly message: string
      readonly hint?: string
    }
  | {
      readonly kind: 'response'
      readonly code: number
      readonly message: string
      readonly reason?: unknown
    }
  | {
      readonly kind: 'transport'
      readonly code: 'CONNECTION_ERROR' | 'DISCONNECTED' | 'TIMEOUT' | 'TRANSPORT_ERROR'
      readonly message: string
      readonly phase: TransportError['phase']
      readonly context: TransportContext
    }
