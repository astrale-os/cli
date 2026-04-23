import { useContext } from 'react'

import { ConnectionContext, type ConnectionContextValue } from '@/providers/connection'

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext)
  if (!ctx) {
    throw new Error('useConnection must be used within a ConnectionProvider')
  }
  return ctx
}
