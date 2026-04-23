import type { MountedWindow, Window } from '@astrale-os/shell'

import { Plus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useShell } from '@/providers/shell'

type WindowsPanelProps = {
  /** Absolute URL the iframe will load (must match expected origin). */
  iframeUrl: string
  /** Function identity minted for each opened window. */
  functionId: string
}

type Row = {
  windowId: string
  functionId: string
  state: string
  mounted: MountedWindow
}

export function WindowsPanel({ iframeUrl, functionId }: WindowsPanelProps) {
  const { shell } = useShell()
  const [rows, setRows] = useState<Row[]>([])
  const [openError, setOpenError] = useState<string | null>(null)
  const [mounting, setMounting] = useState(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null)

  // Reflect lifecycle updates from the shell into the rows' `state` column.
  useEffect(() => {
    if (!shell) return
    const syncStates = () => {
      setRows((prev) =>
        prev.map((r) => {
          const current = shell.windows.get(r.windowId)
          if (!current) return r
          return r.state === current.state ? r : { ...r, state: current.state }
        }),
      )
    }
    const id = setInterval(syncStates, 500)
    return () => clearInterval(id)
  }, [shell])

  // When the active window changes, show/hide iframes accordingly. All iframes
  // remain in the stage container so they preserve state across tab switches.
  useEffect(() => {
    if (!stageRef.current) return
    const stage = stageRef.current
    for (const child of Array.from(stage.children) as HTMLElement[]) {
      const id = child.dataset.windowId
      child.style.display = id && id === activeWindowId ? 'block' : 'none'
    }
  }, [activeWindowId, rows])

  const openWindow = useCallback(async () => {
    if (!shell || !stageRef.current) return
    setMounting(true)
    setOpenError(null)
    try {
      const mounted = await shell.mount({
        host: stageRef.current,
        url: iframeUrl,
        functionId,
        capabilities: { intents: ['open', 'focus', 'closeAck', 'closeRefuse', 'receive'] },
        sandbox: {
          allowScripts: true,
          allowForms: false,
          allowPopups: false,
          allowSameOrigin: true,
          allowModals: false,
        },
      })
      const el = mounted.handle.element as HTMLElement
      el.dataset.windowId = mounted.windowId
      el.style.width = '100%'
      el.style.height = '100%'
      el.style.border = '0'
      el.style.display = 'block'

      const row: Row = {
        windowId: mounted.windowId,
        functionId: mounted.window.functionId,
        state: mounted.window.state,
        mounted,
      }
      setRows((prev) => [...prev, row])
      setActiveWindowId(mounted.windowId)
    } catch (err) {
      setOpenError(describeMountError(err))
    } finally {
      setMounting(false)
    }
  }, [shell, iframeUrl, functionId])

  const closeWindow = useCallback(async (row: Row) => {
    try {
      const result = await row.mounted.close({ timeoutMs: 2000 })
      if (result.kind === 'refused') {
        setOpenError(`Window refused close: ${result.reason ?? 'no reason'}`)
        return
      }
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : 'Close failed')
      return
    }
    setRows((prev) => prev.filter((r) => r.windowId !== row.windowId))
    setActiveWindowId((curr) => (curr === row.windowId ? null : curr))
  }, [])

  if (!shell) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Windows</h3>
          <p className="text-xs text-muted-foreground">
            Mounts a sandboxed iframe via{' '}
            <code className="bg-muted px-1 py-0.5 rounded">shell.mount()</code> — handshake,
            delegation token, and intent pipeline are exercised.
          </p>
        </div>
        <button
          onClick={openWindow}
          disabled={mounting}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="w-3 h-3" />
          {mounting ? 'Opening…' : 'Open window'}
        </button>
      </div>

      {openError && (
        <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
          {openError}
        </div>
      )}

      {rows.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Window</th>
                <th className="px-3 py-2 font-medium">Function</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.windowId} className="border-t border-border">
                  <td className="px-3 py-1.5 font-mono">
                    <button
                      onClick={() => setActiveWindowId(row.windowId)}
                      className={`hover:underline ${
                        activeWindowId === row.windowId ? 'font-semibold' : ''
                      }`}
                    >
                      {row.windowId}
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{row.functionId}</td>
                  <td className="px-3 py-1.5">
                    <StateBadge state={row.state} />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={() => closeWindow(row)}
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-3 h-3" />
                      Close
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border border-border rounded-lg h-[480px] bg-background overflow-hidden relative">
        <div ref={stageRef} className="absolute inset-0" />
        {rows.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground pointer-events-none">
            No window mounted. Click <em>Open window</em> to spawn one.
          </div>
        )}
      </div>
    </div>
  )
}

function StateBadge({ state }: { state: Window['state'] | string }) {
  const color =
    state === 'active'
      ? 'bg-emerald-100 text-emerald-700'
      : state === 'hidden'
        ? 'bg-amber-100 text-amber-700'
        : state === 'closing'
          ? 'bg-orange-100 text-orange-700'
          : 'bg-slate-100 text-slate-600'
  return <span className={`px-2 py-0.5 rounded text-[10px] ${color}`}>{state}</span>
}

function describeMountError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const e = err as { code: string; message?: string }
    return `${e.code}: ${e.message ?? ''}`
  }
  return err instanceof Error ? err.message : 'Mount failed'
}
