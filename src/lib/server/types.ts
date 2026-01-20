export interface HostAppConfig {
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
  bootstrap?: { avatar: string; space: string; global: string }
  remoteAppdata?: { avatar: string; space: string; global: string }
}

export interface DevServerConfig {
  workerUrl: string
  uiUrl?: string
  hostPort: number
  workerOutFile: string
  iframeEntry?: string
  iframeHtml?: string
  projectRoot: string
  hostConfig: HostAppConfig
  onWorkerChange?: () => void
  onIframeChange?: () => void
}

export interface DevServer {
  workerUrl: string
  iframeUrl: string | null
  hostUrl: string
  start(): Promise<void>
  stop(): Promise<void>
}
