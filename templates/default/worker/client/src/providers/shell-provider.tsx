import type { IntentMessage, IntentRegistry, Shell } from '@astrale-os/shell'

import { createShell } from '@astrale-os/shell'
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * Sandboxed-mode shell provider. Runs the init handshake with the parent
 * window, exposes the shell + the currently-targeted nodeId.
 *
 * Hot-swap: the parent pushes a new target via the typed `setTarget`
 * intent. The iframe stays mounted; only `nodeId` updates, so consumers
 * can `useEffect` on it and re-fetch.
 */

export type ShellStatus = 'loading' | 'ready' | 'error'

type ShellContextValue = {
  shell: Shell | null
  status: ShellStatus
  error: string | null
  /** Current target node id (may update via setTarget intent). */
  nodeId: string | undefined
}

const ShellContext = createContext<ShellContextValue>({
  shell: null,
  status: 'loading',
  error: null,
  nodeId: undefined,
})

export function useShell(): ShellContextValue {
  return use(ShellContext)
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [shell, setShell] = useState<Shell | null>(null)
  const [status, setStatus] = useState<ShellStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [nodeId, setNodeId] = useState<string | undefined>(undefined)

  // Handshake boot.
  useEffect(() => {
    let cancelled = false
    let built: Shell | null = null
    void (async () => {
      try {
        built = createShell({ mode: 'sandboxed' })
        await built.init()
        if (cancelled) {
          void built.dispose()
          return
        }
        setShell(built)
        setNodeId(built.targetNodeId)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
      if (built) void built.dispose()
    }
  }, [])

  // Listen for hot-swap: typed `setTarget` intent carries a new nodeId.
  useEffect(() => {
    if (!shell?.parent) return
    return shell.parent.on('intent', (msg: IntentMessage) => {
      if (msg.envelope.name !== 'setTarget') return
      const payload = msg.envelope.payload as IntentRegistry['setTarget']['payload']
      if (typeof payload.nodeId === 'string') setNodeId(payload.nodeId)
    })
  }, [shell])

  const value = useMemo(() => ({ shell, status, error, nodeId }), [shell, status, error, nodeId])
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}
