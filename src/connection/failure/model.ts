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
      readonly context: Readonly<Record<string, unknown>>
    }
