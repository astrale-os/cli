import type { MessageDirection, ShellMessage } from '@astrale-os/shell'

import { ArrowDown, ArrowUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useShell } from '@/providers/shell'

type LogEntry = {
  id: number
  at: number
  direction: MessageDirection
  message: ShellMessage
}

const MAX_ENTRIES = 200

export function MessageLog() {
  const { shell } = useShell()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const idRef = useRef(0)

  useEffect(() => {
    if (!shell) return
    return shell.onMessage((message, direction) => {
      const entry: LogEntry = {
        id: (idRef.current += 1),
        at: Date.now(),
        direction,
        message,
      }
      setEntries((prev) => {
        const next = [entry, ...prev]
        return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next
      })
    })
  }, [shell])

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-muted flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Shell traffic ({entries.length})
        </span>
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setEntries([])}
        >
          Clear
        </button>
      </div>
      <div className="max-h-[40vh] overflow-auto font-mono text-xs">
        {entries.length === 0 && (
          <div className="px-4 py-6 text-center text-muted-foreground">No messages yet.</div>
        )}
        {entries.map((entry) => (
          <MessageRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}

function MessageRow({ entry }: { entry: LogEntry }) {
  const { direction, message, at } = entry
  const time = new Date(at).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const Icon = direction === 'inbound' ? ArrowDown : ArrowUp
  const dirColor = direction === 'inbound' ? 'text-emerald-600' : 'text-blue-600'

  return (
    <div className="px-4 py-1.5 border-t border-border flex items-start gap-3">
      <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${dirColor}`} />
      <span className="text-muted-foreground shrink-0 w-16">{time}</span>
      <span className="shrink-0 w-14 uppercase text-muted-foreground tracking-wide">
        {message.type}
      </span>
      <span className="flex-1 min-w-0 truncate">{summarize(message)}</span>
    </div>
  )
}

function summarize(message: ShellMessage): string {
  switch (message.type) {
    case 'intent':
      return `${String(message.envelope.name)} from=${message.envelope.sender.windowId}${
        message.envelope.correlationId ? ` corr=${message.envelope.correlationId}` : ''
      }`
    case 'ctrl':
      return `${message.action} ${JSON.stringify(redact(message.data))}`
    case 'error':
      return `${message.code}: ${message.message}`
  }
}

function redact(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data
  const obj = data as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase().includes('token') || k.toLowerCase().includes('credential')) {
      out[k] = typeof v === 'string' ? `${v.slice(0, 12)}…` : '[redacted]'
    } else {
      out[k] = v
    }
  }
  return out
}
