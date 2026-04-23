import { useState, useCallback } from 'react'

import { useWorkspace } from '@/hooks/use-workspace'

export function QueryPanel() {
  const workspace = useWorkspace()
  const [cypher, setCypher] = useState('')
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const execute = useCallback(async () => {
    if (!cypher.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cypher }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setResult(json.result)
      workspace.appendLog({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        level: 'success',
        message: `Cypher query OK`,
        data: res,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Query failed'
      setError(msg)
      workspace.appendLog({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        level: 'error',
        message: `Cypher query failed`,
        data: msg,
      })
    } finally {
      setLoading(false)
    }
  }, [cypher, workspace])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        execute()
      }
    },
    [execute],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-2">
        <textarea
          value={cypher}
          onChange={(e) => setCypher(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="MATCH (n) RETURN n LIMIT 10"
          className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          rows={4}
          spellCheck={false}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={execute}
            disabled={loading || !cypher.trim()}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Running...' : 'Run'}
          </button>
          <span className="text-[10px] text-muted-foreground">
            {navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {error && <pre className="whitespace-pre-wrap text-xs text-destructive">{error}</pre>}
        {result !== null && (
          <div className="relative">
            <button
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(result, null, 2))
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="absolute right-1 top-1 rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <pre className="whitespace-pre-wrap text-xs text-foreground">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
        {!error && result === null && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Run a Cypher query to see results
          </div>
        )}
      </div>
    </div>
  )
}
