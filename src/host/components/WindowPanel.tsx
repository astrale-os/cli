import { useState, useEffect, useCallback } from 'react'
import { cn, WINDOW_BORDER_RADIUS } from '@astrale-os/ui'
import type { IframeRef } from '../lib/shell-adapter'
import type { AppConfig, WindowInfo } from '../types'

interface WindowPanelProps {
  config: AppConfig
  windows: WindowInfo[]
  pendingIframes: Map<string, { src: string; onWindowReady: (win: Window) => void }>
  iframeRefs: Map<string, IframeRef>
  onOpenWindow: () => void
  onCloseWindow: (nodeId: string) => void
  registerIframeRef: (nodeId: string, el: HTMLIFrameElement | null) => void
  disabled: boolean
}

export function WindowPanel({
  config,
  windows,
  pendingIframes,
  onOpenWindow,
  onCloseWindow,
  registerIframeRef,
  disabled,
}: WindowPanelProps) {
  const [selectedWindow, setSelectedWindow] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const toggleFullscreen = useCallback(() => setIsFullscreen((prev) => !prev), [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen])

  const activeWindow =
    selectedWindow && windows.find((w) => w.nodeId === selectedWindow)
      ? selectedWindow
      : (windows[0]?.nodeId ?? null)
  const allWindowIds = new Set([...windows.map((w) => w.nodeId), ...pendingIframes.keys()])

  return (
    <div className={cn('window-panel', isFullscreen && 'fullscreen')}>
      <div className="window-controls">
        <button className="btn btn-primary" onClick={onOpenWindow} disabled={disabled}>
          <span>🪟</span>
          <span>Open Window</span>
        </button>
        {windows.length > 0 && (
          <div className="window-tabs">
            {windows.map((win) => (
              <button
                key={win.nodeId}
                className={cn('window-tab', activeWindow === win.nodeId && 'active')}
                onClick={() => setSelectedWindow(win.nodeId)}
              >
                {win.nodeId.slice(-8)}
              </button>
            ))}
          </div>
        )}
      </div>

      {allWindowIds.size === 0 ? (
        <div className="iframe-container">
          <div className="iframe-empty">
            <div className="iframe-empty-icon">🖼️</div>
            <div>No windows open</div>
            <div className="iframe-empty-hint">Click "Open Window" to start</div>
          </div>
        </div>
      ) : (
        <div
          className="window-chrome"
          style={{ borderRadius: isFullscreen ? 0 : WINDOW_BORDER_RADIUS }}
        >
          <div className="window-titlebar">
            <div className="window-traffic-lights">
              <button
                className="traffic-light close"
                onClick={() => activeWindow && onCloseWindow(activeWindow)}
                title="Close"
              />
              <button className="traffic-light minimize" disabled title="Minimize" />
              <button
                className="traffic-light maximize"
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              />
            </div>
            <div className="window-title">{activeWindow?.slice(-8)}</div>
          </div>
          <div className="iframe-container">
            {Array.from(allWindowIds).map((nodeId) => {
              const pending = pendingIframes.get(nodeId)
              const src = pending?.src ?? config.uiUrl
              return (
                <iframe
                  key={nodeId}
                  ref={(el) => registerIframeRef(nodeId, el)}
                  src={src}
                  title={`Window ${nodeId}`}
                  className={activeWindow !== nodeId ? 'hidden' : ''}
                  allow="clipboard-write"
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
