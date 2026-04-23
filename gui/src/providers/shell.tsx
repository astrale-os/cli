import { createIframeShellAdapter, createShell, type Shell } from '@astrale-os/shell'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { getCredential } from '@/server/credentials'

export type ShellStatus = 'loading' | 'ready' | 'error'

type ShellContextValue = {
  shell: Shell | null
  status: ShellStatus
  error: string | null
  kernelUrl: string
}

const ShellContext = createContext<ShellContextValue>({
  shell: null,
  status: 'loading',
  error: null,
  kernelUrl: '',
})

export function useShell(): ShellContextValue {
  return useContext(ShellContext)
}

export function useKernel() {
  const { shell, status } = useShell()
  if (!shell || status !== 'ready') return null
  return shell.kernel
}

// ─── Standalone ─────────────────────────────────────────────────────────────

/**
 * Boot a standalone shell — entry point identity, credential fetched from
 * `authEndpoint`. Re-mounts when `kernelUrl` changes.
 */
export function StandaloneShellProvider({
  kernelUrl,
  children,
}: {
  kernelUrl: string
  children: ReactNode
}) {
  const [status, setStatus] = useState<ShellStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [shell, setShell] = useState<Shell | null>(null)
  const disposedRef = useRef<Shell | null>(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    setShell(null)

    async function boot() {
      try {
        // Derive audience from kernelUrl — child kernels validate JWT `aud`
        // against their own issuer (e.g. `http://localhost:4400/aaa`).
        const aud = kernelUrl.replace(/\/+$/, '')
        const auth = await getCredential({ data: { aud } })
        if (!auth?.credential) throw new Error('No credential from getCredential server fn')

        if (cancelled) return

        const next = createShell({
          mode: 'standalone',
          kernelUrl,
          credential: auth.credential,
          adapter: createIframeShellAdapter({
            className: 'w-full h-full border-0',
          }),
        })
        await next.init()

        if (cancelled) {
          void next.dispose()
          return
        }

        disposedRef.current = next
        setShell(next)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Shell boot failed')
        setStatus('error')
      }
    }

    void boot()
    return () => {
      cancelled = true
      const current = disposedRef.current
      if (current) {
        disposedRef.current = null
        void current.dispose()
      }
    }
  }, [kernelUrl])

  const value = useMemo(
    () => ({ shell, status, error, kernelUrl }),
    [shell, status, error, kernelUrl],
  )

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

// Back-compat alias — the old name.
export const ShellProvider = StandaloneShellProvider

// ─── Sandboxed ──────────────────────────────────────────────────────────────

/**
 * Boot a sandboxed shell — meant to run inside an iframe. Performs the
 * INIT_REQUEST handshake with the parent and receives its delegation token
 * from the handshake, not from a local auth endpoint.
 */
export function SandboxedShellProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ShellStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [shell, setShell] = useState<Shell | null>(null)

  useEffect(() => {
    let cancelled = false
    let built: Shell | null = null

    async function boot() {
      try {
        built = createShell({
          mode: 'sandboxed',
          adapter: createIframeShellAdapter({ className: 'w-full h-full border-0' }),
        })
        await built.init()
        if (cancelled) {
          void built.dispose()
          return
        }
        setShell(built)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Sandboxed init failed')
        setStatus('error')
      }
    }

    void boot()
    return () => {
      cancelled = true
      if (built) void built.dispose()
    }
  }, [])

  const value = useMemo(
    () => ({ shell, status, error, kernelUrl: shell?.kernel ? '(delegated)' : '' }),
    [shell, status, error],
  )

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}
