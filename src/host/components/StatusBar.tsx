import type { ConnectionStatus, ShellState } from '../types'

interface StatusBarProps {
  status: ConnectionStatus
  shellState: ShellState | null
  kernelWsUrl: string
}

export function StatusBar({ status, shellState, kernelWsUrl }: StatusBarProps) {
  const workerCount = shellState ? Object.keys(shellState.backgroundWorkers).length : 0
  const tokenCount = shellState ? Object.keys(shellState.appTokens).length : 0
  const windowCount = shellState ? Object.keys(shellState.windows).length : 0

  const statusLabel =
    status === 'connected'
      ? 'Connected'
      : status === 'connecting'
        ? 'Connecting...'
        : status === 'error'
          ? 'Error'
          : 'Disconnected'

  return (
    <div className="status-bar">
      <div className="status-item">
        <span className={`status-dot ${status}`} />
        <span className="status-label">{statusLabel}</span>
      </div>
      <div className="status-item">
        <span>Kernel:</span>
        <span className="status-value">{kernelWsUrl}</span>
      </div>
      <div className="status-item">
        <span>Workers:</span>
        <span className="count-badge">{workerCount}</span>
      </div>
      <div className="status-item">
        <span>Tokens:</span>
        <span className="count-badge">{tokenCount}</span>
      </div>
      <div className="status-item">
        <span>Windows:</span>
        <span className="count-badge">{windowCount}</span>
      </div>
    </div>
  )
}
