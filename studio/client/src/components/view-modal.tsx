import type {
  ViewInfo,
  ViewSessionResult,
  ViewTargetCandidate,
  ViewTargetResult,
} from '@shared/types'

import {
  AlertCircle,
  Check,
  ChevronsUpDown,
  ExternalLink,
  Loader2,
  MonitorPlay,
  RefreshCw,
  Search,
  Server,
  Unplug,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '@/lib/api'
import { useViewRuntime } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

type SessionState =
  | { phase: 'idle' | 'launching' }
  | { phase: 'ready'; session: Extract<ViewSessionResult, { status: 'ready' }> }
  | { phase: 'error'; reason: string }

/**
 * A local-first view workbench. Studio owns the Vite lifecycle; the CLI-owned
 * session still owns identity, active-instance data, delegation, and the shell
 * handshake. Opening the dialog is the only start action the user needs.
 */
export function ViewModal({
  domainId,
  view,
  open,
  onOpenChange,
}: {
  domainId: string
  view: ViewInfo
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const runtimeQuery = useViewRuntime(domainId, view.slug, open)
  const runtime = runtimeQuery.data
  const [targetId, setTargetId] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [restarting, setRestarting] = useState(false)
  const [session, setSession] = useState<SessionState>({ phase: 'idle' })
  const initializedFor = useRef('')

  useEffect(() => {
    if (!open) {
      initializedFor.current = ''
      setTargetId('')
      setSession({ phase: 'idle' })
      return
    }
    if (!runtime) return
    const key = `${domainId}:${view.slug}:${runtime.instance ?? 'none'}`
    if (initializedFor.current === key) return
    initializedFor.current = key
    setTargetId(runtime.targets.selected?.id ?? '')
  }, [domainId, open, runtime, view.slug])

  const targetReady =
    !!runtime &&
    (!runtime.targetRequired || runtime.targets.items.some((target) => target.id === targetId))
  const serverGeneration =
    runtime?.server.status === 'running' ? runtime.server.startedAt : 'not-running'
  const launchReady =
    open && !restarting && !!runtime?.instance && runtime.server.status === 'running' && targetReady

  useEffect(() => {
    if (!launchReady) {
      setSession({ phase: 'idle' })
      return
    }
    let disposed = false
    let openedSessionId: string | null = null
    setSession({ phase: 'launching' })
    void api
      .launchView(domainId, view.slug, targetId ? { targetId } : {})
      .then((result) => {
        if (result.status === 'ready') {
          openedSessionId = result.sessionId
          if (disposed) void api.closeViewSession(domainId, result.sessionId)
          else setSession({ phase: 'ready', session: result })
        } else if (!disposed) {
          setSession({ phase: 'error', reason: result.reason })
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setSession({
            phase: 'error',
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => {
      disposed = true
      if (openedSessionId) void api.closeViewSession(domainId, openedSessionId)
    }
  }, [attempt, domainId, launchReady, runtime?.instance, serverGeneration, targetId, view.slug])

  useEffect(() => {
    if (session.phase !== 'ready') return
    const closeOnPageExit = () => {
      const url = `/api/domain/${encodeURIComponent(domainId)}/views/sessions/close`
      navigator.sendBeacon(
        url,
        new Blob([JSON.stringify({ sessionId: session.session.sessionId })], {
          type: 'application/json',
        }),
      )
    }
    window.addEventListener('pagehide', closeOnPageExit)
    return () => window.removeEventListener('pagehide', closeOnPageExit)
  }, [domainId, session])

  const restart = async () => {
    if (restarting) return
    setRestarting(true)
    setSession({ phase: 'idle' })
    try {
      await api.restartViewServer(domainId)
      await runtimeQuery.refetch()
      setAttempt((value) => value + 1)
    } catch (error) {
      setSession({
        phase: 'error',
        reason: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setRestarting(false)
    }
  }

  const runningServer = runtime?.server.status === 'running' ? runtime.server : null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[90vh] w-[95vw] max-w-[1500px] grid-rows-[auto_auto_1fr] gap-0 overflow-hidden rounded-2xl p-0">
        <header className="flex min-w-0 items-center gap-3 border-b bg-card/95 px-4 py-3 pr-12">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-500/12 text-sky-400">
            <MonitorPlay className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <DialogTitle className="truncate text-sm font-semibold">{view.slug}</DialogTitle>
              <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                view.{view.slug}
              </code>
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {view.description ?? 'Domain view preview'}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {session.phase === 'ready' && (
              <a
                href={session.session.pageUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open separately
              </a>
            )}
            <button
              type="button"
              onClick={() => void restart()}
              disabled={!runtime || restarting}
              title="Restart the managed local preview"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', restarting && 'animate-spin')} />
            </button>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-3 border-b bg-muted/15 px-4 py-3">
          {runtime?.targetRequired ? (
            <TargetPicker
              result={runtime.targets}
              value={targetId}
              onChange={setTargetId}
              instance={runtime.instance}
            />
          ) : (
            <div className="inline-flex h-9 items-center gap-2 rounded-xl border bg-background/60 px-3 text-[11px]">
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="font-medium">Standalone view</span>
              <span className="text-muted-foreground">No target required</span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <div
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[10px]',
                runningServer
                  ? 'border-emerald-500/20 bg-emerald-500/8 text-emerald-200'
                  : 'bg-background/60 text-muted-foreground',
              )}
              title={
                runningServer
                  ? `Studio-managed server; sleeps after ${formatDuration(runningServer.idleTimeoutMs)} without an open view.`
                  : runtime?.server.status === 'failed' || runtime?.server.status === 'unavailable'
                    ? runtime.server.reason
                    : 'Starting the local frontend…'
              }
            >
              {runningServer ? (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-30" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
              ) : runtime ? (
                <AlertCircle className="h-3 w-3 text-amber-400" />
              ) : (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              <Server className="h-3.5 w-3.5" />
              <span className="font-medium">Managed locally</span>
              {runningServer && <code className="opacity-65">:{runningServer.port}</code>}
            </div>
            <div className="h-9 rounded-xl border bg-background/60 px-3 py-1.5 text-right text-[9px] uppercase leading-tight tracking-wider text-muted-foreground">
              <div>Data instance</div>
              <div className="max-w-40 truncate text-[10px] font-medium normal-case tracking-normal text-foreground">
                {runtime?.instance ?? 'not selected'}
              </div>
            </div>
          </div>
        </div>

        <main className="relative min-h-0 overflow-hidden bg-[#0d0d11]">
          {session.phase === 'ready' && runningServer ? (
            <iframe
              key={session.session.sessionId}
              src={session.session.pageUrl}
              title={`${view.slug} preview`}
              className="h-full w-full border-0 bg-white"
              allow="clipboard-read; clipboard-write"
            />
          ) : (
            <PreviewState
              loading={runtimeQuery.isLoading || restarting || session.phase === 'launching'}
              runtimeError={runtimeQuery.isError}
              runtime={runtime}
              targetId={targetId}
              sessionError={session.phase === 'error' ? session.reason : undefined}
              onRetry={() => void restart()}
            />
          )}
        </main>
      </DialogContent>
    </Dialog>
  )
}

function TargetPicker({
  result,
  value,
  onChange,
  instance,
}: {
  result: ViewTargetResult
  value: string
  onChange: (id: string) => void
  instance: string | null
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selected = result.items.find((item) => item.id === value) ?? null
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return result.items
    return result.items.filter((item) =>
      [item.label, item.description, item.className, item.status, item.id]
        .filter(Boolean)
        .some((text) => text!.toLocaleLowerCase().includes(query)),
    )
  }, [result.items, search])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-9 min-w-64 max-w-[28rem] items-center gap-2 rounded-xl border bg-background/60 px-3 text-left transition-colors hover:bg-accent/40',
            result.stale && !selected && 'border-amber-500/40',
          )}
        >
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              selected
                ? 'bg-emerald-400'
                : result.stale
                  ? 'bg-amber-400'
                  : 'bg-muted-foreground/30',
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">
              Target
            </span>
            <span className="block truncate text-[11px] font-medium">
              {selected?.label ?? result.stale?.label ?? 'Select a target'}
            </span>
          </span>
          <span className="text-[10px] text-muted-foreground">{result.items.length}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="z-[70] w-[28rem] p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search visible targets…"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
          />
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {instance ?? 'no instance'}
          </span>
        </div>

        {result.stale && (
          <div className="m-2 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 p-2.5 text-[11px] text-amber-200">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <strong>{result.stale.label}</strong> was remembered, but it was deleted or is no
              longer visible. Pick a replacement.
            </span>
          </div>
        )}

        <div className="max-h-80 overflow-y-auto p-1.5">
          {result.status === 'unavailable' ? (
            <PickerEmpty>{result.reason ?? 'Targets could not be queried.'}</PickerEmpty>
          ) : filtered.length === 0 ? (
            <PickerEmpty>
              {result.items.length === 0 ? 'No eligible targets are visible.' : 'No matches.'}
            </PickerEmpty>
          ) : (
            filtered.map((item) => (
              <TargetOption
                key={item.id}
                item={item}
                selected={item.id === value}
                onClick={() => {
                  onChange(item.id)
                  setOpen(false)
                }}
              />
            ))
          )}
        </div>
        {result.truncated && (
          <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
            Showing the first 200 visible targets per class.
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function TargetOption({
  item,
  selected,
  onClick,
}: {
  item: ViewTargetCandidate
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent',
        selected && 'bg-accent/70',
      )}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-[10px] font-semibold text-sky-300">
        {item.className.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{item.label}</span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {[item.className, item.description, item.status].filter(Boolean).join(' · ')}
        </span>
      </span>
      <code className="text-[9px] text-muted-foreground/50">{item.id.slice(0, 8)}</code>
      {selected && <Check className="h-3.5 w-3.5 text-primary" />}
    </button>
  )
}

function PickerEmpty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">{children}</div>
}

function PreviewState({
  loading,
  runtimeError,
  runtime,
  targetId,
  sessionError,
  onRetry,
}: {
  loading: boolean
  runtimeError: boolean
  runtime?: ReturnType<typeof useViewRuntime>['data']
  targetId: string
  sessionError?: string
  onRetry: () => void
}) {
  if (loading) {
    return (
      <StateFrame icon={<Loader2 className="animate-spin" />} title="Preparing local preview">
        Studio is starting the domain frontend and connecting it to the active data instance.
      </StateFrame>
    )
  }
  if (runtimeError) {
    return (
      <StateFrame icon={<Unplug />} title="The Studio runtime did not respond" action={onRetry}>
        Retry the managed preview. The schema canvas is unaffected.
      </StateFrame>
    )
  }
  if (!runtime?.instance) {
    return (
      <StateFrame icon={<Unplug />} title="Choose an Astrale instance">
        The local frontend always reads data from the active instance in the Studio header.
      </StateFrame>
    )
  }
  if (runtime.targetRequired && !runtime.targets.items.some((target) => target.id === targetId)) {
    const stale = runtime.targets.stale
    return (
      <StateFrame
        icon={<Search />}
        title={stale ? 'The remembered target is gone' : 'Choose what this view should open'}
      >
        {stale
          ? `${stale.label} was deleted or is no longer visible. Use the target selector above.`
          : runtime.targets.items.length
            ? `${runtime.targets.items.length} visible candidate${runtime.targets.items.length === 1 ? '' : 's'} found on ${runtime.instance}.`
            : runtime.targets.reason || 'No eligible targets are currently visible.'}
      </StateFrame>
    )
  }
  if (sessionError) {
    return (
      <StateFrame icon={<AlertCircle />} title="The view could not be opened" action={onRetry}>
        {sessionError}
      </StateFrame>
    )
  }
  if (runtime.server.status !== 'running') {
    return (
      <StateFrame icon={<Server />} title="Local preview could not start" action={onRetry}>
        {runtime.server.reason}
      </StateFrame>
    )
  }
  return (
    <StateFrame icon={<Loader2 className="animate-spin" />} title="Opening view session">
      The frontend is ready. Studio is preparing its authenticated shell session.
    </StateFrame>
  )
}

function StateFrame({
  icon,
  title,
  children,
  action,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  action?: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center text-zinc-200">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-zinc-400 [&_svg]:h-5 [&_svg]:w-5">
        {icon}
      </div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-1.5 max-w-md text-[12px] leading-relaxed text-zinc-500">{children}</div>
      {action && (
        <button
          type="button"
          onClick={action}
          className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] transition-colors hover:bg-white/10"
        >
          Restart preview
        </button>
      )}
    </div>
  )
}

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}
