import type { FunctionSchema, Protocol } from '@astrale-os/kernel-client'
import type { SchemaTypedClientSession } from '@astrale-os/kernel-client/session'

import { ClientSession } from '@astrale-os/kernel-client/session'
import { KernelSchema } from '@astrale-os/kernel-core'
import { ManagerSchema } from '@astrale-os/kernel-toolkit/manager-schema'
import { createContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'

import { getCredential } from '@/server/credentials'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
/** UI label for `Protocol` — kept as `BindingMode` for backward-compatible imports. */
export type BindingMode = Protocol

const BINDING_STORAGE_KEY = 'astrale-playground:binding-mode'

function loadBindingMode(): BindingMode {
  const stored = globalThis.localStorage?.getItem(BINDING_STORAGE_KEY)
  if (stored === 'envelope' || stored === 'auto') return stored
  return 'envelope'
}

function normalizeUrl(url: string): string {
  return url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
}

/**
 * Fetch an audience-scoped credential from the Start server function.
 * Reads the manager's keys directly from the bind-mount — no browser token,
 * no sessionStorage, no `/api/auth` endpoint.
 */
async function fetchCredential(aud: string): Promise<string | null> {
  try {
    const res = await getCredential({ data: { aud } })
    return res?.credential ?? null
  } catch {
    return null
  }
}

export type TypedKernel = SchemaTypedClientSession<typeof KernelSchema>
export type TypedManager = SchemaTypedClientSession<typeof ManagerSchema>

export interface ConnectionContextValue {
  status: ConnectionStatus
  url: string | null
  error: string | null
  authReady: boolean
  bindingMode: BindingMode
  connect: (url: string) => void
  disconnect: () => void
  call: <T = unknown>(method: string, params: Record<string, unknown>) => Promise<T>
  /**
   * Schema-bound typed view of the connection. `null` until connected; use
   * `kernel.static('Root').installDomain(...)` etc. instead of raw `call`
   * strings whenever the target is a kernel class method.
   */
  kernel: TypedKernel | null
  /**
   * Schema-bound typed view of the manager domain. `null` until connected;
   * use `manager.static('KernelInstance').register(...)` etc. for all
   * `manager.astrale.ai` calls.
   */
  manager: TypedManager | null
  setBindingMode: (mode: BindingMode) => void
  /** Check whether a method has a route binding (i.e. routed mode would work) */
  hasRouteBinding: (method: string) => boolean
}

export const ConnectionContext = createContext<ConnectionContextValue | null>(null)

export function ConnectionProvider({
  children,
  skipAutoConnect,
}: {
  children: ReactNode
  skipAutoConnect?: boolean
}) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [bindingMode, setBindingModeState] = useState<BindingMode>(loadBindingMode)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionRef = useRef<ClientSession<any> | null>(null)
  const credentialRef = useRef<string>('')
  const bindingModeRef = useRef<BindingMode>(bindingMode)
  const [kernel, setKernel] = useState<TypedKernel | null>(null)
  const [manager, setManager] = useState<TypedManager | null>(null)

  const loadSchemas = useCallback((session: ClientSession<any>, sessionUrl: string) => {
    // Fetch function schemas with binding info, best-effort
    session
      .call('/kernel.astrale.ai/interface.Function/list', {})
      .then((result: unknown) => {
        const entries = Array.isArray(result) ? result : (result as Record<string, unknown>)?.items
        if (!Array.isArray(entries)) return
        // Wire entries already match FunctionSchema; only fix up ambient
        // functions whose binding has a route but no remoteUrl.
        const schemas = (entries as FunctionSchema[]).filter((e) => e && e.binding)
        for (const e of schemas) {
          const binding = e.binding as Record<string, unknown>
          if (binding.route && !binding.remoteUrl) binding.remoteUrl = sessionUrl
        }
        if (schemas.length) session.registry.load(schemas)
      })
      .catch(() => {
        /* schema loading is best-effort */
      })
  }, [])

  const connect = useCallback(
    (rawUrl: string) => {
      if (sessionRef.current) {
        sessionRef.current.disconnect()
        sessionRef.current = null
      }

      const httpUrl = normalizeUrl(rawUrl)
      const aud = httpUrl.replace(/\/+$/, '')
      setUrl(httpUrl)
      setError(null)
      setStatus('connecting')

      // Fetch a credential scoped to this target's audience BEFORE opening
      // the session. Without this, the server returns only the manager's
      // credential which gets rejected by child kernels (audience mismatch).
      void fetchCredential(aud).then((credential) => {
        if (credential) credentialRef.current = credential

        const session = new ClientSession({
          default: httpUrl,
          identity: () => credentialRef.current,
        })
        sessionRef.current = session
        setKernel(session.withSchema(KernelSchema))
        setManager(session.withSchema(ManagerSchema))

        session
          .call('__probe__', {}, { transport: 'ws', timeout: 30_000 })
          .then(() => {
            setStatus('connected')
            loadSchemas(session, httpUrl)
          })
          .catch((err: unknown) => {
            const isTransportError =
              err instanceof Error &&
              (err.constructor.name === 'ConnectionError' ||
                err.constructor.name === 'DisconnectedError' ||
                err.constructor.name === 'TimeoutError')
            if (isTransportError) {
              setStatus('error')
              setError(err instanceof Error ? err.message : 'Connection failed')
            } else {
              setStatus('connected')
              loadSchemas(session, httpUrl)
            }
          })
      })
    },
    [loadSchemas],
  )

  const disconnect = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.disconnect()
      sessionRef.current = null
    }
    setKernel(null)
    setManager(null)
    setStatus('disconnected')
    setUrl(null)
    setError(null)
  }, [])

  const call = useCallback(
    <T = unknown,>(method: string, params: Record<string, unknown>): Promise<T> => {
      const session = sessionRef.current
      if (!session) return Promise.reject(new Error('Not connected'))
      return session.call(method, params, {
        protocol: bindingModeRef.current,
      }) as Promise<T>
    },
    [],
  )

  const setBindingMode = useCallback((mode: BindingMode) => {
    setBindingModeState(mode)
    bindingModeRef.current = mode
    globalThis.localStorage?.setItem(BINDING_STORAGE_KEY, mode)
  }, [])

  const hasRouteBinding = useCallback((method: string): boolean => {
    const session = sessionRef.current
    if (!session) return false
    const schema = session.describe(method)
    return !!schema?.binding?.route
  }, [])

  // Auto-connect to the manager unless skipped. Credential is fetched
  // inside `connect()` scoped to the target audience — see `fetchCredential`.
  useEffect(() => {
    setAuthReady(true)
    if (!skipAutoConnect) {
      connect('http://localhost:4400/mngt/')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.disconnect()
        sessionRef.current = null
      }
    }
  }, [])

  return (
    <ConnectionContext.Provider
      value={{
        status,
        url,
        error,
        authReady,
        bindingMode,
        connect,
        disconnect,
        call,
        kernel,
        manager,
        setBindingMode,
        hasRouteBinding,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  )
}
