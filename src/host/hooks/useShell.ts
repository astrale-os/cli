/**
 * Shell Hook
 *
 * Manages the shell lifecycle: kernel connection, app loading, and shell initialization.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { createShellAdapter, type IframeRef, type ShellAdapter } from '../lib/shell-adapter'
import { createBrowserWorkerFactory } from '../lib/worker-factory'
import type { AppConfig, AppManifest, ConnectionStatus, ShellState, WindowInfo } from '../types'
import { createShellLogger, type UseLogsResult } from './useLogs'

// Shell and Kernel types (injected at runtime via bundle)
declare const ShellBundle: {
  Shell: new (
    config: {
      kernel: {
        wsUrl: string
        getToken: () => string | Promise<string>
        avatarId: string
        autoConnect: boolean
      }
      adapter: ShellAdapter
    },
    options: {
      logger: ReturnType<typeof createShellLogger>
      workerFactory: ReturnType<typeof createBrowserWorkerFactory>
    },
  ) => ShellInstance
  wrapControl: (msg: { type: string; payload: unknown }) => unknown
  MSG: { SHELL: { INIT_PORT: string } }
}

declare const KernelWSClientBundle: {
  KernelWSClient: new (config: {
    wsUrl: string
    getToken: () => string | Promise<string>
    autoConnect?: boolean
    reconnect?: boolean
  }) => KernelWSClient
}

interface ShellInstance {
  initialize: () => Promise<void>
  registerApp: (app: AppRegistration) => void
  openWindow: (opts: { appId: string; nodeId: string; title: string }) => Promise<void>
  closeWindow: (nodeId: string) => Promise<void>
  getState: () => ShellState
}

interface AppRegistration {
  appId: string
  name: string
  workerUrl: string
  iframeUrl: string
  backendUrl?: string
  metadata?: Record<string, unknown>
  appdata?: AppManifest['appdata']
  types?: AppManifest['types']
}

interface SessionInfo {
  userId: string
  avatarsAndSpaces: Array<{ avatarId: string; spaceId: string }>
}

interface KernelWSClient {
  connect: () => Promise<void>
  disconnect: () => void
  waitForSessionInfo: (timeoutMs?: number) => Promise<SessionInfo>
  callSystem: (
    method: string,
    params: unknown,
    ctx: { avatarId: string; appId: string },
  ) => Promise<unknown>
}

const APPMGR_APP_ID = 'astrale.ai/appmgr'

export interface UseShellResult {
  // State
  status: ConnectionStatus
  shell: ShellInstance | null
  manifest: AppManifest | null
  windows: WindowInfo[]
  shellState: ShellState | null

  // Actions
  initialize: () => Promise<void>
  openWindow: () => Promise<void>
  closeWindow: (nodeId: string) => Promise<void>

  // Iframe management (for React components)
  iframeRefs: Map<string, IframeRef>
  pendingIframes: Map<string, { src: string; onWindowReady: (win: Window) => void }>
  registerIframeRef: (nodeId: string, el: HTMLIFrameElement | null) => void
}

export function useShell(config: AppConfig | null, logs: UseLogsResult): UseShellResult {
  const { log } = logs

  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [shell, setShell] = useState<ShellInstance | null>(null)
  const [manifest, setManifest] = useState<AppManifest | null>(null)
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const [shellState, setShellState] = useState<ShellState | null>(null)

  // Iframe management
  const iframeRefs = useRef<Map<string, IframeRef>>(new Map())
  const pendingIframes = useRef<Map<string, { src: string; onWindowReady: (win: Window) => void }>>(
    new Map(),
  )

  // Shell state polling
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const registerIframeRef = useCallback((nodeId: string, el: HTMLIFrameElement | null) => {
    if (!el) {
      iframeRefs.current.delete(nodeId)
      return
    }

    const pending = pendingIframes.current.get(nodeId)
    if (pending) {
      iframeRefs.current.set(nodeId, {
        element: el,
        onWindowReady: pending.onWindowReady,
      })

      // Register window with shell when iframe loads
      const handleLoad = () => {
        if (el.contentWindow) {
          pending.onWindowReady(el.contentWindow)
        }
      }

      // Register immediately if already loaded
      if (el.contentWindow) {
        pending.onWindowReady(el.contentWindow)
      }

      el.onload = handleLoad
      pendingIframes.current.delete(nodeId)
    }
  }, [])

  const initialize = useCallback(async () => {
    if (!config || status !== 'disconnected') return

    setStatus('connecting')
    log('Starting initialization...', 'info')

    try {
      // Step 1: Load app manifest from kernel
      log('Connecting to kernel to load app manifest...', 'info')
      const kernelClient = new KernelWSClientBundle.KernelWSClient({
        wsUrl: config.kernelWsUrl,
        getToken: () => config.accessToken,
        autoConnect: true,
        reconnect: false,
      })

      await kernelClient.connect()
      log('Kernel connected', 'success')

      const sessionInfo = await kernelClient.waitForSessionInfo()
      const avatarMapping = sessionInfo.avatarsAndSpaces.find((m) => m.spaceId === config.spaceId)
      if (!avatarMapping) {
        log(
          `No avatar found for space ${config.spaceId}. Try: astrale space create <name> && astrale init`,
          'error',
        )
        setStatus('error')
        kernelClient.disconnect()
        return
      }
      const avatarId = avatarMapping.avatarId
      log(`Using avatar ${avatarId}`, 'debug')

      const ctx = { avatarId, appId: APPMGR_APP_ID }
      const loadResult = (await kernelClient.callSystem(
        'appmgr.load',
        { appId: config.appId },
        ctx,
      )) as AppManifest

      kernelClient.disconnect()

      setManifest(loadResult)
      log(`App loaded: ${loadResult.name} (${loadResult.slug})`, 'success')
      log(`Types: ${loadResult.types.map((t) => t.name).join(', ')}`, 'debug')

      // Step 2: Create shell adapter
      const adapter = createShellAdapter(
        iframeRefs.current,
        (nodeId, src, onWindowReady) => {
          pendingIframes.current.set(nodeId, { src, onWindowReady })
          // Add window to state AND trigger re-render
          setWindows((prev) => {
            // Only add if not already present
            if (prev.some((w) => w.nodeId === nodeId)) return prev
            return [...prev, { nodeId, title: nodeId, createdAt: new Date() }]
          })
        },
        (nodeId) => {
          setWindows((prev) => prev.filter((w) => w.nodeId !== nodeId))
        },
      )

      // Step 3: Create shell instance
      log('Initializing shell...', 'info')
      const shellLogger = createShellLogger(log)
      const workerFactory = createBrowserWorkerFactory(
        ShellBundle.wrapControl,
        ShellBundle.MSG.SHELL.INIT_PORT,
        (msg, level) => log(`[Worker] ${msg}`, level === 'error' ? 'error' : 'debug'),
      )

      const shellInstance = new ShellBundle.Shell(
        {
          kernel: {
            wsUrl: config.kernelWsUrl,
            getToken: () => config.accessToken,
            avatarId,
            autoConnect: true,
          },
          adapter,
        },
        {
          logger: shellLogger,
          workerFactory,
        },
      )

      await shellInstance.initialize()
      log('Shell initialized', 'success')

      // Step 4: Register app with real appdata and types
      log('Registering app...', 'info')
      shellInstance.registerApp({
        appId: config.appId,
        name: loadResult.name,
        workerUrl: config.workerUrl,
        iframeUrl: config.uiUrl,
        backendUrl: loadResult.backendUrl,
        metadata: {},
        appdata: loadResult.appdata,
        types: loadResult.types,
      })
      log('loadResult: ' + JSON.stringify(loadResult, null, 2), 'debug')
      log('App registered with kernel appdata', 'success')

      setShell(shellInstance)
      setStatus('connected')

      // Start polling shell state
      pollIntervalRef.current = setInterval(() => {
        setShellState(shellInstance.getState())
      }, 1000)

      // Auto-open first window
      log('Opening initial window...', 'info')
      const nodeId = `window-${Date.now()}`
      const title = `${loadResult.name} Window`

      await shellInstance.openWindow({
        appId: config.appId,
        nodeId,
        title,
      })
      log(`Initial window opened: ${nodeId}`, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log(`Initialization failed: ${message}`, 'error')
      setStatus('error')
    }
  }, [config, status, log])

  // Auto-initialize on mount
  useEffect(() => {
    if (config && status === 'disconnected') {
      initialize()
    }
  }, [config, status, initialize])

  const openWindow = useCallback(async () => {
    if (!shell || !config) return

    const nodeId = `window-${Date.now()}`
    const title = `${manifest?.name ?? 'App'} Window`

    log(`Opening window ${nodeId}...`, 'info')

    try {
      await shell.openWindow({
        appId: config.appId,
        nodeId,
        title,
      })
      // Note: window is added to state via onMount callback in the shell adapter

      log(`Window opened: ${nodeId}`, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log(`Failed to open window: ${message}`, 'error')
    }
  }, [shell, config, manifest, log])

  const closeWindow = useCallback(
    async (nodeId: string) => {
      if (!shell) return

      log(`Closing window ${nodeId}...`, 'info')

      try {
        await shell.closeWindow(nodeId)
        setWindows((prev) => prev.filter((w) => w.nodeId !== nodeId))
        iframeRefs.current.delete(nodeId)
        pendingIframes.current.delete(nodeId)
        log(`Window closed: ${nodeId}`, 'success')
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log(`Failed to close window: ${message}`, 'error')
      }
    },
    [shell, log],
  )

  return {
    status,
    shell,
    manifest,
    windows,
    shellState,
    initialize,
    openWindow,
    closeWindow,
    iframeRefs: iframeRefs.current,
    pendingIframes: pendingIframes.current,
    registerIframeRef,
  }
}
