/**
 * Host App Main Component
 */

import { Header, LogPanel, StatusBar, WindowPanel } from './components'
import { useConfig, useLogs, useShell } from './hooks'

function LoadingScreen({ message }: { message?: string }) {
  return (
    <div className="loading">
      <div className="loading-spinner" />
      <div>{message ?? 'Loading...'}</div>
    </div>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="error-screen">
      <h2>⚠️ Error</h2>
      <p className="error-message">{message}</p>
      <p className="error-hint">
        Make sure you've run <code>worker-init</code> and the kernel is running.
      </p>
    </div>
  )
}

export function App() {
  const { config, loading: configLoading, error: configError } = useConfig()
  const logs = useLogs()
  const shell = useShell(config, logs)

  // Configuration loading state
  if (configLoading) {
    return <LoadingScreen message="Loading configuration..." />
  }

  // Configuration error state
  if (configError || !config) {
    return <ErrorScreen message={configError ?? 'No configuration found'} />
  }

  // Shell initialization in progress
  if (shell.status === 'connecting') {
    return (
      <div className="host-app">
        <Header config={config} manifest={shell.manifest} />
        <StatusBar
          status={shell.status}
          shellState={shell.shellState}
          kernelUrl={config.kernelUrl}
        />
        <LoadingScreen message="Connecting to kernel and initializing shell..." />
      </div>
    )
  }

  // Shell initialization error
  if (shell.status === 'error') {
    return (
      <div className="host-app">
        <Header config={config} manifest={shell.manifest} />
        <StatusBar
          status={shell.status}
          shellState={shell.shellState}
          kernelUrl={config.kernelUrl}
        />
        <ErrorScreen message="Failed to initialize shell. Check logs for details." />
      </div>
    )
  }

  const isInitialized = shell.status === 'connected'

  return (
    <div className="host-app">
      <Header config={config} manifest={shell.manifest} />
      <StatusBar status={shell.status} shellState={shell.shellState} kernelUrl={config.kernelUrl} />
      <div className="main-content">
        <WindowPanel
          config={config}
          windows={shell.windows}
          pendingIframes={shell.pendingIframes}
          iframeRefs={shell.iframeRefs}
          onOpenWindow={shell.openWindow}
          onCloseWindow={shell.closeWindow}
          registerIframeRef={shell.registerIframeRef}
          disabled={!isInitialized}
        />
        <LogPanel logs={logs.logs} onClear={logs.clear} />
      </div>
    </div>
  )
}
