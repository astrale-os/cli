export type TransportDiagnosticContext =
  | { readonly kind: 'acquisition'; readonly resource: 'publication' | 'bundle' }
  | {
      readonly kind: 'invocation'
      readonly delivery: 'not-sent' | 'unknown'
      readonly invocation?: unknown
    }

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
      readonly phase: string
      readonly context: TransportDiagnosticContext
    }
