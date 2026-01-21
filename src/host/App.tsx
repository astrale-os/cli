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
      <div style={{ fontSize: 32 }}>⚠️</div>
      <h2>Error</h2>
      <p>{message}</p>
      <p style={{ fontSize: 13, opacity: 0.6 }}>
        Make sure you've run <code>worker-init</code> and the kernel is running.
      </p>
    </div>
  )
}

export function App() {
  const { config, loading: configLoading, error: configError } = useConfig()
  const logs = useLogs()
  const shell = useShell(config, logs)

  if (configLoading) {
    return (
      <div className="host-app">
        <LoadingScreen message="Loading configuration..." />
      </div>
    )
  }

  if (configError || !config) {
    return (
      <div className="host-app">
        <ErrorScreen message={configError ?? 'No configuration found'} />
      </div>
    )
  }

  if (shell.status === 'connecting') {
    return (
      <div className="host-app">
        <Header config={config} manifest={shell.manifest} />
        <StatusBar
          status={shell.status}
          shellState={shell.shellState}
          kernelWsUrl={config.kernelWsUrl}
        />
        <LoadingScreen message="Connecting to kernel and initializing shell..." />
      </div>
    )
  }

  if (shell.status === 'error') {
    return (
      <div className="host-app">
        <Header config={config} manifest={shell.manifest} />
        <StatusBar
          status={shell.status}
          shellState={shell.shellState}
          kernelWsUrl={config.kernelWsUrl}
        />
        <ErrorScreen message="Failed to initialize shell. Check logs for details." />
      </div>
    )
  }

  return (
    <div className="host-app">
      <Header config={config} manifest={shell.manifest} />
      <StatusBar
        status={shell.status}
        shellState={shell.shellState}
        kernelWsUrl={config.kernelWsUrl}
      />
      <div className="main-content">
        <WindowPanel
          config={config}
          windows={shell.windows}
          pendingIframes={shell.pendingIframes}
          iframeRefs={shell.iframeRefs}
          onOpenWindow={shell.openWindow}
          onCloseWindow={shell.closeWindow}
          registerIframeRef={shell.registerIframeRef}
          disabled={shell.status !== 'connected'}
        />
        <LogPanel logs={logs.logs} onClear={logs.clear} />
      </div>
    </div>
  )
}
