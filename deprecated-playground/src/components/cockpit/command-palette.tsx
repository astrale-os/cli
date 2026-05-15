import { Search, RotateCcw, Trash2, Package, ChevronLeft } from 'lucide-react'
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'

import { getSampleDomains } from '@/domains/catalog'
import { useConnection } from '@/hooks/use-connection'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'

export interface QuickAction {
  id: string
  label: string
  description?: string
  icon: React.ReactNode
  keywords?: string[]
  run: () => void | Promise<void>
}

type PaletteMode =
  | { kind: 'actions' }
  | { kind: 'pick-domain'; domains: { name: string; description: string; spec: unknown }[] }

function useQuickActions(setMode: (mode: PaletteMode) => void): QuickAction[] {
  const workspace = useWorkspace()

  return useMemo<QuickAction[]>(
    () => [
      {
        id: 'reboot-clear-graph',
        label: 'Reboot (clear graph)',
        description: 'Clear the entire graph and reboot the kernel',
        icon: <RotateCcw className="h-4 w-4" />,
        keywords: ['reboot', 'reset', 'clear', 'graph', 'wipe', 'restart'],
        run: async () => {
          try {
            const res = await fetch('/api/reboot', { method: 'POST' })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            workspace.clearLogs()
            workspace.setSelection(null)
            workspace.appendLog({
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              level: 'info',
              message: 'Graph cleared and kernel rebooted',
            })
            setTimeout(() => workspace.refreshGraphState(), 500)
          } catch (e) {
            workspace.appendLog({
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              level: 'error',
              message: `Reboot failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
            })
          }
        },
      },
      {
        id: 'install-domain',
        label: 'Install domain',
        description: 'Install a sample domain into the kernel graph',
        icon: <Package className="h-4 w-4" />,
        keywords: ['install', 'domain', 'schema', 'toto', 'sample'],
        run: () => {
          const domains = getSampleDomains()
          setMode({ kind: 'pick-domain', domains })
        },
      },
      {
        id: 'clear-console',
        label: 'Clear console',
        description: 'Remove all console log entries',
        icon: <Trash2 className="h-4 w-4" />,
        keywords: ['clear', 'console', 'logs', 'clean'],
        run: () => workspace.clearLogs(),
      },
      {
        id: 'refresh-graph',
        label: 'Refresh graph state',
        description: 'Re-fetch the graph from the kernel',
        icon: <RotateCcw className="h-4 w-4" />,
        keywords: ['refresh', 'reload', 'graph', 'fetch', 'sync'],
        run: () => workspace.refreshGraphState(),
      },
    ],
    [workspace, setMode],
  )
}

function matchAction(action: QuickAction, query: string): boolean {
  const q = query.toLowerCase()
  if (action.label.toLowerCase().includes(q)) return true
  if (action.description?.toLowerCase().includes(q)) return true
  if (action.keywords?.some((k) => k.includes(q))) return true
  return false
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const workspace = useWorkspace()
  const { kernel } = useConnection()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mode, setMode] = useState<PaletteMode>({ kind: 'actions' })
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const actions = useQuickActions(setMode)

  // Build items based on mode
  const items = useMemo<QuickAction[]>(() => {
    if (mode.kind === 'pick-domain') {
      return mode.domains.map((d) => ({
        id: `domain-${d.name}`,
        label: d.name,
        description: d.description,
        icon: <Package className="h-4 w-4" />,
        keywords: [d.name, 'domain'],
        run: async () => {
          if (!kernel) {
            workspace.appendLog({
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              level: 'error',
              message: 'Install failed: kernel not connected',
            })
            return
          }
          try {
            workspace.appendLog({
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              level: 'info',
              message: `Installing domain "${d.name}"...`,
            })
            const result = (await kernel.static('Root').installDomain({
              spec: d.spec as never,
              identity: undefined,
            })) as { domainId: string; origin?: string }
            workspace.appendLog({
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              level: 'info',
              message: `Domain "${d.name}" installed — domainId: ${result.domainId}`,
            })
            setTimeout(() => workspace.refreshGraphState(), 300)
          } catch (e) {
            workspace.appendLog({
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              level: 'error',
              message: `Install failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
            })
          }
        },
      }))
    }
    return actions
  }, [mode, actions, workspace, kernel])

  const filtered = useMemo(
    () => (query ? items.filter((a) => matchAction(a, query)) : items),
    [items, query],
  )

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setMode({ kind: 'actions' })
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Keep selectedIndex in bounds
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // Reset query/selection when mode changes
  useEffect(() => {
    setQuery('')
    setSelectedIndex(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [mode])

  const runAction = useCallback(
    (action: QuickAction) => {
      if (mode.kind === 'pick-domain') {
        onClose()
      }
      action.run()
    },
    [onClose, mode],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered[selectedIndex]) runAction(filtered[selectedIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (mode.kind !== 'actions') {
          setMode({ kind: 'actions' })
        } else {
          onClose()
        }
      } else if (e.key === 'Backspace' && query === '' && mode.kind !== 'actions') {
        e.preventDefault()
        setMode({ kind: 'actions' })
      }
    },
    [filtered, selectedIndex, runAction, onClose, mode, query],
  )

  if (!open) return null

  const placeholder = mode.kind === 'pick-domain' ? 'Pick a domain...' : 'Type a command...'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-md rounded-lg border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {mode.kind !== 'actions' && (
            <button
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setMode({ kind: 'actions' })}
              title="Back"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {mode.kind === 'pick-domain' && (
            <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground">
              domain
            </span>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {mode.kind === 'pick-domain' ? 'No matching domains' : 'No matching actions'}
            </div>
          )}
          {filtered.map((action, i) => (
            <button
              key={action.id}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                i === selectedIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-accent/50',
              )}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={() => runAction(action)}
            >
              <span className="shrink-0 text-muted-foreground">{action.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{action.label}</div>
                {action.description && (
                  <div className="truncate text-xs text-muted-foreground">{action.description}</div>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground/60">
          <span>↑↓ Navigate</span>
          <span>↵ Run</span>
          <span>Esc {mode.kind !== 'actions' ? 'Back' : 'Close'}</span>
        </div>
      </div>
    </div>
  )
}

/** Small trigger button to show in the command bar */
export function CommandPaletteTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      title="Quick actions (⌘K)"
    >
      <span>⌘K</span>
    </button>
  )
}
