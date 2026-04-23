import type { FunctionSchema, SchemaTypedClient } from '@astrale-os/kernel-client'

import { KernelClient, type BindingMode } from '@astrale-os/kernel-client'
import { KernelSchema } from '@astrale-os/kernel-core'
import { ManagerSchema } from '@astrale-os/kernel-toolkit/manager-schema'
import { createContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type { BindingMode } from '@astrale-os/kernel-client'

const BINDING_STORAGE_KEY = 'astrale-playground:binding-mode'
const API_TOKEN_STORAGE_KEY = 'astrale-playground:api-token'
const API_TOKEN_PARAM = 'token'
const API_TOKEN_HEADER = 'x-astrale-token'

function loadBindingMode(): BindingMode {
  const stored = globalThis.localStorage?.getItem(BINDING_STORAGE_KEY)
  if (stored === 'envelope' || stored === 'routed') return stored
  return 'envelope'
}

function normalizeUrl(url: string): string {
  return url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
}

/**
 * Extract the API token from the URL on first load, persist it to
 * sessionStorage, and strip it from the URL bar so it doesn't leak via
 * referrer/history. Falls back to a previously-stored token on reloads.
 */
function captureApiToken(): string | null {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const fromUrl = url.searchParams.get(API_TOKEN_PARAM)
  if (fromUrl) {
    window.sessionStorage?.setItem(API_TOKEN_STORAGE_KEY, fromUrl)
    url.searchParams.delete(API_TOKEN_PARAM)
    window.history.replaceState({}, '', url.toString())
    return fromUrl
  }
  return window.sessionStorage?.getItem(API_TOKEN_STORAGE_KEY) ?? null
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
      setUrl(httpUrl)
      setError(null)
      setStatus('connecting')

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

  // Fetch credential (best-effort); auto-connect to manager unless skipped.
  // The manager is always mounted at /mngt/ via the Vite proxy — we connect
  // unconditionally and let the client's transport-fallback surface errors.
  // The launch URL embeds an API token (?token=...) which gates /api/auth;
  // we capture it once into sessionStorage and present it on every fetch.
  useEffect(() => {
    if (status !== 'disconnected') return
    const token = captureApiToken()
    const headers: HeadersInit = token ? { [API_TOKEN_HEADER]: token } : {}
    fetch('/api/auth', { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((auth) => {
        if (auth?.credential) credentialRef.current = auth.credential
        else if (token) {
          // Stale or rejected token — clear it so the user is prompted to
          // re-open the URL with the current `?token=...`.
          window.sessionStorage?.removeItem(API_TOKEN_STORAGE_KEY)
          setError('API token rejected — re-open the URL printed by `astrale start`.')
        }
      })
      .catch(() => {})
      .finally(() => {
        setAuthReady(true)
        if (!skipAutoConnect) {
          connect(`http://${window.location.host}/mngt/`)
        }
      })
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
