import { useRef, useEffect, useState } from 'react'

import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const time = d.toLocaleTimeString('en-US', { hour12: false })
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${time}.${ms}`
}

const levelColors: Record<string, string> = {
  info: 'text-foreground',
  warn: 'text-yellow-600',
  error: 'text-destructive',
  success: 'text-green-600',
}

export function ConsolePanel() {
  const { consoleLogs } = useWorkspace()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [consoleLogs.length])

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-auto font-mono text-xs">
        {consoleLogs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Console output will appear here
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {consoleLogs.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  'px-3 py-1.5',
                  entry.data !== undefined && 'cursor-pointer hover:bg-accent/30',
                )}
                onClick={() => {
                  if (entry.data !== undefined) {
                    setExpandedId(expandedId === entry.id ? null : entry.id)
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground shrink-0">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                  <span
                    className={cn(
                      'rounded px-1 py-0.5 text-[10px] font-semibold uppercase',
                      levelColors[entry.level],
                    )}
                  >
                    {entry.level}
                  </span>
                  <span className="truncate">{entry.message}</span>
                </div>

                {expandedId === entry.id && entry.data !== undefined && (
                  <pre className="mt-1 rounded bg-muted/50 p-2 text-[11px] overflow-auto max-h-48 whitespace-pre-wrap">
                    {typeof entry.data === 'string'
                      ? entry.data
                      : JSON.stringify(entry.data, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
