import type { FunctionSchema, SchemaTypedClient } from '@astrale-os/kernel-client'

import { KernelClient, type BindingMode } from '@astrale-os/kernel-client'
import { KernelSchema } from '@astrale-os/kernel-core'
import { ManagerSchema } from '@astrale-os/kernel-toolkit/manager-schema'
import { createContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'

import { getCredential } from '@/server/credentials'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type { BindingMode } from '@astrale-os/kernel-client'

const BINDING_STORAGE_KEY = 'astrale-playground:binding-mode'

function loadBindingMode(): BindingMode {
  const stored = globalThis.localStorage?.getItem(BINDING_STORAGE_KEY)
  if (stored === 'envelope' || stored === 'routed') return stored
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

export type TypedKernel = SchemaTypedClient<typeof KernelSchema>
export type TypedManager = SchemaTypedClient<typeof ManagerSchema>

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
  const clientRef = useRef<KernelClient<any> | null>(null)
  const credentialRef = useRef<string>('')
  const bindingModeRef = useRef<BindingMode>(bindingMode)
  const [kernel, setKernel] = useState<TypedKernel | null>(null)
  const [manager, setManager] = useState<TypedManager | null>(null)

  const loadSchemas = useCallback((client: KernelClient<any>) => {
    // Fetch function schemas with binding info, best-effort
    client
      .call(
        '/kernel.astrale.ai/interface.Function/list' as never,
        {} as never,
        credentialRef.current,
      )
      .then((result: unknown) => {
        const entries = Array.isArray(result) ? result : (result as Record<string, unknown>)?.items
        if (!Array.isArray(entries)) return
        // Wire entries already match FunctionSchema; only fix up ambient
        // functions whose binding has a route but no remoteUrl.
        const schemas = (entries as FunctionSchema[]).filter((e) => e && e.binding)
        for (const e of schemas) {
          const binding = e.binding as Record<string, unknown>
          if (binding.route && !binding.remoteUrl) binding.remoteUrl = client.url
        }
        if (schemas.length) client.load(schemas)
      })
      .catch(() => {
        /* schema loading is best-effort */
      })
  }, [])

  const connect = useCallback(
    (rawUrl: string) => {
      if (clientRef.current) {
        clientRef.current.disconnect()
        clientRef.current = null
      }

      const httpUrl = normalizeUrl(rawUrl)
      const aud = httpUrl.replace(/\/+$/, '')
      setUrl(httpUrl)
      setError(null)
      setStatus('connecting')

      // Fetch a credential scoped to this target's audience BEFORE opening
      // the client. Without this, the server returns only the manager's
      // credential which gets rejected by child kernels (audience mismatch).
      void fetchCredential(aud).then((credential) => {
        if (credential) credentialRef.current = credential

        const client = new KernelClient({
          url: httpUrl,
          defaultTransport: 'ws',
          requestTimeout: 30_000,
        })
        clientRef.current = client
        const bound = client.as(() => credentialRef.current)
        setKernel(bound.withSchema(KernelSchema))
        setManager(bound.withSchema(ManagerSchema))

        bound
          .call('__probe__' as never, {} as never)
          .then(() => {
            setStatus('connected')
            loadSchemas(client)
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
              loadSchemas(client)
            }
          })
      })
    },
    [loadSchemas],
  )

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect()
      clientRef.current = null
    }
    setKernel(null)
    setManager(null)
    setStatus('disconnected')
    setUrl(null)
    setError(null)
  }, [])

  const call = useCallback(
    <T = unknown>(method: string, params: Record<string, unknown>): Promise<T> => {
      const client = clientRef.current
      if (!client) return Promise.reject(new Error('Not connected'))
      return client.call(method as never, params as never, credentialRef.current, {
        via: bindingModeRef.current,
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
    const client = clientRef.current
    if (!client) return false
    const schema = client.describe(method)
    return !!schema?.binding?.route
  }, [])

  // Auto-connect to the manager unless skipped. Credential is fetched
  // inside `connect()` scoped to the target audience — see `fetchCredential`.
  useEffect(() => {
    setAuthReady(true)
    if (!skipAutoConnect) {
      connect(`http://${window.location.host}/mngt/`)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect()
        clientRef.current = null
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
