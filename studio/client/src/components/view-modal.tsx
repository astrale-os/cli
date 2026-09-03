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
  Unplug,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '@/lib/api'
import { useViewRuntime } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { DescriptionText } from './studio-kit'
import { Dialog, DialogClose, DialogContent, DialogTitle } from './ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

type SessionState =
  | { phase: 'idle' | 'launching' }
  | { phase: 'ready'; session: Extract<ViewSessionResult, { status: 'ready' }> }
  | { phase: 'error'; reason: string }

/**
 * A View workbench backed by the CLI-owned session. `astrale view` resolves the
 * installed placement and owns identity, active-instance data, delegation, and
 * the Shell mount. Opening the dialog is the only start action the user needs.
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
  const launchReady = open && !restarting && !!runtime?.instance && targetReady

  useEffect(() => {
    if (!launchReady) {
      setSession({ phase: 'idle' })
      return
    }
    let disposed = false
    let openedSessionId: string | null = null
    setSession({ phase: 'launching' })
    void api
      .launchView(domainId, view.slug, {
        preparationId: runtime.preparationId,
        ...(targetId ? { targetId } : {}),
      })
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
  }, [domainId, launchReady, runtime?.instance, runtime?.preparationId, targetId, view.slug])

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
      await runtimeQuery.refetch()
    } catch (error) {
      setSession({
        phase: 'error',
        reason: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setRestarting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="grid h-[90vh] w-[95vw] max-w-[1500px] grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-xl p-0"
      >
        <header className="flex min-w-0 items-center gap-3 border-b bg-card px-4 py-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-schema-view/10 text-schema-view">
            <MonitorPlay className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="truncate text-sm font-semibold">{view.slug}</DialogTitle>
            {view.description && (
              <DescriptionText className="truncate text-xs text-muted-foreground">
                {view.description}
              </DescriptionText>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {runtime?.targetRequired && (
              <TargetPicker
                result={runtime.targets}
                value={targetId}
                onChange={setTargetId}
                instance={runtime.instance}
              />
            )}
            {session.phase === 'ready' && (
              <a
                href={session.session.pageUrl}
                target="_blank"
                rel="noreferrer"
                title="Open in a new tab"
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            <button
              type="button"
              onClick={() => void restart()}
              disabled={restarting}
              title="Reload the view session"
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <RefreshCw className={cn('h-4 w-4', restarting && 'animate-spin')} />
            </button>
            <DialogClose
              title="Close"
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>
        </header>

        <main className="relative min-h-0 overflow-hidden bg-muted">
          {session.phase === 'ready' ? (
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
            'flex h-8 min-w-52 max-w-[22rem] items-center gap-2 rounded-md border bg-card px-2.5 text-left transition-colors hover:bg-accent',
            result.stale && !selected && 'border-warning/50',
          )}
        >
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              selected ? 'bg-success' : result.stale ? 'bg-warning' : 'bg-muted-foreground/40',
            )}
          />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {selected?.label ?? result.stale?.label ?? 'Select a target'}
          </span>
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
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {instance ?? 'no instance'}
          </span>
        </div>

        {result.stale && (
          <div className="m-2 flex gap-2 rounded-lg border border-warning/25 bg-warning/8 p-2.5 text-[11px] text-warning">
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
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">
        {item.className.slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{item.label}</span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {[item.className, item.description, item.status].filter(Boolean).join(' · ')}
        </span>
      </span>
      <code className="text-[9px] text-muted-foreground">{item.id.slice(0, 8)}</code>
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
      <StateFrame icon={<Loader2 className="animate-spin" />} title="Resolving installed View">
        The Astrale CLI is resolving the View and connecting it to the active data instance.
      </StateFrame>
    )
  }
  if (runtimeError) {
    return (
      <StateFrame icon={<Unplug />} title="The Studio runtime did not respond" action={onRetry}>
        Retry the View session. The schema canvas is unaffected.
      </StateFrame>
    )
  }
  if (!runtime?.instance) {
    return (
      <StateFrame icon={<Unplug />} title="Choose an Astrale instance">
        The installed View reads data from the active instance in the Studio header.
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
  return (
    <StateFrame icon={<Loader2 className="animate-spin" />} title="Opening view session">
      Studio is preparing the authenticated CLI-owned Shell session.
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
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl border bg-card text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">
        {icon}
      </div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-1.5 max-w-md text-[12px] leading-relaxed text-muted-foreground">
        {children}
      </div>
      {action && (
        <button
          type="button"
          onClick={action}
          className="mt-4 rounded-md border bg-card px-3 py-1.5 text-[11px] transition-colors hover:bg-accent"
        >
          Restart preview
        </button>
      )}
    </div>
  )
}
