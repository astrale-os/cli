export interface DevServerConfig {
  workerUrl: string
  uiUrl?: string
  hostPort: number
  workerOutFile: string
  iframeEntry?: string
  iframeHtml?: string
  projectRoot: string
  configPath: string
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
