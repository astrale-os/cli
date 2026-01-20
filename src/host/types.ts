/**
 * Host App Types
 */

export type LogLevel = 'debug' | 'info' | 'success' | 'warning' | 'error'

export interface LogEntry {
  id: string
  timestamp: Date
  level: LogLevel
  message: string
  data?: unknown
}

export interface AppConfig {
  appId: string
  spaceId: string
  kernelWsUrl: string
  datastoreUrl: string
  accessToken: string
  workerUrl: string
  uiUrl: string
  typesContainerId?: string
  bundleWorkerId?: string
  bundleUiId?: string
  bundleSourceId?: string
  bootstrap?: {
    avatar: string
    space: string
    global: string
  }
  remoteAppdata?: {
    avatar: string
    space: string
    global: string
  }
}

export interface AppManifest {
  name: string
  slug: string
  backendUrl?: string
  workerBundle: BundleResult
  uiBundle: BundleResult
  types: Array<{ id: string; name: string; title: string }>
  appdata: AppAppdataScopes
}

export type BundleResult = { mode: 'url'; url: string } | { mode: 'source'; grant: unknown }

export interface AppdataModule {
  moduleId: string
  typeKey: string
  children?: Record<string, AppdataModule>
}

export interface ResolvedAppdata {
  rootId: string
  modules: Record<string, AppdataModule>
}

export interface AppAppdataScopes {
  avatar: ResolvedAppdata
  space: ResolvedAppdata
  global: ResolvedAppdata
}

export interface WindowInfo {
  nodeId: string
  title: string
  createdAt: Date
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ShellState {
  backgroundWorkers: Record<string, unknown>
  appTokens: Record<string, unknown>
  windows: Record<string, unknown>
}
