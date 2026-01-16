/**
 * Status Bar Component
 */

import type { ConnectionStatus, ShellState } from '../types'

interface StatusBarProps {
  status: ConnectionStatus
  shellState: ShellState | null
  kernelUrl: string
}

export function StatusBar({ status, shellState, kernelUrl }: StatusBarProps) {
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
        <span>{statusLabel}</span>
      </div>
      <div className="status-item">
        <span style={{ color: 'var(--text-muted)' }}>Kernel:</span>
        <span className="mono">{kernelUrl}</span>
      </div>
      <div className="status-item">
        <span style={{ color: 'var(--text-muted)' }}>Workers:</span>
        <span>{workerCount}</span>
      </div>
      <div className="status-item">
        <span style={{ color: 'var(--text-muted)' }}>Tokens:</span>
        <span>{tokenCount}</span>
      </div>
      <div className="status-item">
        <span style={{ color: 'var(--text-muted)' }}>Windows:</span>
        <span>{windowCount}</span>
      </div>
    </div>
  )
}
