import { useEffect, useRef, useState, useCallback } from 'react'
import type { LogEntry } from '../types'

interface LogPanelProps {
  logs: LogEntry[]
  onClear: () => void
}

function formatTime(date: Date): string {
  return date.toISOString().split('T')[1]?.slice(0, 12) ?? ''
}

function getFirstLine(message: string): string {
  const firstLine = message.split('\n')[0] ?? message
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine
}

const MIN_WIDTH = 280
const MAX_WIDTH_RATIO = 0.7
const MIN_DETAIL_HEIGHT = 80
const MAX_DETAIL_HEIGHT_RATIO = 0.6
const DEFAULT_DETAIL_HEIGHT_RATIO = 0.4

export function LogPanel({ logs, onClear }: LogPanelProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [width, setWidth] = useState(320)
  const [detailHeight, setDetailHeight] = useState<number | null>(null)
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null)
  const [isResizingWidth, setIsResizingWidth] = useState(false)
  const [isResizingHeight, setIsResizingHeight] = useState(false)
  const [activeFilters, setActiveFilters] = useState<Set<string>>(
    new Set(['debug', 'info', 'success', 'warning', 'error']),
  )

  const toggleFilter = useCallback((level: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }, [])

  const filteredLogs = logs.filter((log) => activeFilters.has(log.level))

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight
  }, [logs])

  useEffect(() => {
    if (selectedLog && detailHeight === null && panelRef.current) {
      const panelHeight = panelRef.current.getBoundingClientRect().height
      setDetailHeight(Math.max(MIN_DETAIL_HEIGHT, panelHeight * DEFAULT_DETAIL_HEIGHT_RATIO))
    }
  }, [selectedLog, detailHeight])

  useEffect(() => {
    if (!selectedLog) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const currentIndex = filteredLogs.findIndex((l) => l.id === selectedLog.id)
      if (currentIndex === -1) return
      if (e.key === 'ArrowDown' && currentIndex < filteredLogs.length - 1) {
        e.preventDefault()
        setSelectedLog(filteredLogs[currentIndex + 1]!)
      } else if (e.key === 'ArrowUp' && currentIndex > 0) {
        e.preventDefault()
        setSelectedLog(filteredLogs[currentIndex - 1]!)
      } else if (e.key === 'Escape') {
        setSelectedLog(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedLog, filteredLogs])

  useEffect(() => {
    if (!selectedLog || !contentRef.current) return
    const selectedElement = contentRef.current.querySelector('.log-selected')
    if (selectedElement) selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedLog])

  const handleWidthMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizingWidth(true)
  }, [])

  const handleHeightMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizingHeight(true)
  }, [])

  useEffect(() => {
    if (!isResizingWidth) return
    const handleMouseMove = (e: MouseEvent) => {
      const maxWidth = window.innerWidth * MAX_WIDTH_RATIO
      const newWidth = window.innerWidth - e.clientX
      setWidth(Math.max(MIN_WIDTH, Math.min(maxWidth, newWidth)))
    }
    const handleMouseUp = () => setIsResizingWidth(false)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingWidth])

  useEffect(() => {
    if (!isResizingHeight || !panelRef.current) return
    const handleMouseMove = (e: MouseEvent) => {
      const panelRect = panelRef.current!.getBoundingClientRect()
      const maxHeight = panelRect.height * MAX_DETAIL_HEIGHT_RATIO
      const newHeight = panelRect.bottom - e.clientY
      setDetailHeight(Math.max(MIN_DETAIL_HEIGHT, Math.min(maxHeight, newHeight)))
    }
    const handleMouseUp = () => setIsResizingHeight(false)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingHeight])

  if (collapsed) {
    return (
      <div className="log-panel-collapsed" onClick={() => setCollapsed(false)}>
        <span className="log-collapsed-icon">◀</span>
        <span className="log-collapsed-count">{logs.length}</span>
      </div>
    )
  }

  return (
    <div className="log-panel" ref={panelRef} style={{ width }}>
      <div className="log-resize-handle" onMouseDown={handleWidthMouseDown} />
      <div className="log-header">
        <span className="log-header-title">
          <span>Logs</span>
          <span className="log-count">{logs.length}</span>
        </span>
        <div className="log-header-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClear}>
            Clear
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setCollapsed(true)}>
            ▶
          </button>
        </div>
      </div>
      <div className="log-legend">
        <button
          className={`log-legend-item ${activeFilters.has('info') ? 'active' : ''}`}
          onClick={() => toggleFilter('info')}
        >
          <span className="log-dot log-dot-info" />
          Info
        </button>
        <button
          className={`log-legend-item ${activeFilters.has('success') ? 'active' : ''}`}
          onClick={() => toggleFilter('success')}
        >
          <span className="log-dot log-dot-success" />
          Success
        </button>
        <button
          className={`log-legend-item ${activeFilters.has('warning') ? 'active' : ''}`}
          onClick={() => toggleFilter('warning')}
        >
          <span className="log-dot log-dot-warning" />
          Warning
        </button>
        <button
          className={`log-legend-item ${activeFilters.has('error') ? 'active' : ''}`}
          onClick={() => toggleFilter('error')}
        >
          <span className="log-dot log-dot-error" />
          Error
        </button>
      </div>
      <div className="log-content" ref={contentRef}>
        {filteredLogs.length === 0 ? (
          <div className="log-empty">{logs.length === 0 ? 'No logs yet' : 'No matching logs'}</div>
        ) : (
          filteredLogs.map((entry) => (
            <div
              key={entry.id}
              className={`log-entry log-${entry.level} ${selectedLog?.id === entry.id ? 'log-selected' : ''}`}
              onClick={() => setSelectedLog(selectedLog?.id === entry.id ? null : entry)}
            >
              <span className="log-time">{formatTime(entry.timestamp)}</span>
              <span className="log-message">{getFirstLine(entry.message)}</span>
            </div>
          ))
        )}
      </div>
      {selectedLog && (
        <div className="log-detail" style={{ height: detailHeight ?? '40%' }}>
          <div className="log-detail-resize" onMouseDown={handleHeightMouseDown} />
          <div className="log-detail-header">
            <span className="log-detail-time">{formatTime(selectedLog.timestamp)}</span>
            <span className={`log-detail-level log-${selectedLog.level}`}>{selectedLog.level}</span>
            <button className="log-detail-close" onClick={() => setSelectedLog(null)}>
              ×
            </button>
          </div>
          <pre className="log-detail-content">{selectedLog.message}</pre>
        </div>
      )}
    </div>
  )
}
