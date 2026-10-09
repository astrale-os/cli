import type { ViewInfo, ViewSessionResult } from '@shared/types'

import { AlertCircle, ExternalLink, Loader2, MonitorPlay, RefreshCw, Unplug, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '@/lib/api'
import { useViewRuntime } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { DescriptionText } from './studio-kit'
import { Dialog, DialogClose, DialogContent, DialogTitle } from './ui/dialog'

type ViewRuntime = NonNullable<ReturnType<typeof useViewRuntime>['data']>

type SessionState =
  | { phase: 'idle' | 'launching' }
  | { phase: 'ready'; session: Extract<ViewSessionResult, { status: 'ready' }> }
  | { phase: 'error'; reason: string }

const errorReason = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * A View workbench backed by the CLI-owned session. `astrale view` resolves the
 * installed placement and owns identity, active-instance data, delegation, and
 * the Shell mount. Every View belongs to its Domain and opens on it: there is no
 * target to pick. Opening the dialog is the only start action the user needs.
 *
 * The dialog holds one named page of that session and hands exactly that page
 * back when it goes. It never closes the session: the operator may have opened
 * the same View in a tab of their own, and the session server keeps the session
 * up for as long as any page still holds it.
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
  // This dialog's page of whatever session it is showing. Stable for the life of
  // the dialog, and never the id of the tab the View was popped out into.
  const [pageId] = useState(() => crypto.randomUUID())
  const [restarting, setRestarting] = useState(false)
  const [session, setSession] = useState<SessionState>({ phase: 'idle' })

  const launchReady = open && !restarting && !!runtime?.instance

  useEffect(() => {
    if (!launchReady) {
      setSession({ phase: 'idle' })
      return
    }
    let disposed = false
    let openedSessionId: string | null = null
    setSession({ phase: 'launching' })
    void api
      .launchView(domainId, view.slug, { preparationId: runtime.preparationId })
      .then((result) => {
        if (result.status === 'ready') {
          openedSessionId = result.sessionId
          if (disposed) void api.releaseViewSession(domainId, result.sessionId, pageId)
          else setSession({ phase: 'ready', session: result })
        } else if (!disposed) {
          setSession({ phase: 'error', reason: result.reason })
        }
      })
      .catch((error: unknown) => {
        if (!disposed) setSession({ phase: 'error', reason: errorReason(error) })
      })
    return () => {
      disposed = true
      if (openedSessionId) void api.releaseViewSession(domainId, openedSessionId, pageId)
    }
  }, [domainId, launchReady, pageId, runtime?.instance, runtime?.preparationId, view.slug])

  // Unloading Studio takes this dialog's page with it, and an unload runs no
  // effect cleanup. Release that page here so a session nobody else holds does
  // not sit out its idle budget - and so one a popped-out tab holds survives.
  useEffect(() => {
    if (session.phase !== 'ready') return
    const releaseOnPageExit = () => {
      const url = `/api/domain/${encodeURIComponent(domainId)}/views/sessions/release`
      navigator.sendBeacon(
        url,
        new Blob([JSON.stringify({ sessionId: session.session.sessionId, page: pageId })], {
          type: 'application/json',
        }),
      )
    }
    window.addEventListener('pagehide', releaseOnPageExit)
    return () => window.removeEventListener('pagehide', releaseOnPageExit)
  }, [domainId, pageId, session])

  const restart = async () => {
    if (restarting) return
    setRestarting(true)
    setSession({ phase: 'idle' })
    try {
      await runtimeQuery.refetch()
    } catch (error) {
      setSession({ phase: 'error', reason: errorReason(error) })
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
            {session.phase === 'ready' && (
              <a
                href={session.session.pageUrl}
                target="_blank"
                rel="noreferrer"
                title="Open in a new tab (the View stays open after this dialog closes)"
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
              src={`${session.session.pageUrl}?page=${encodeURIComponent(pageId)}`}
              title={`${view.slug} preview`}
              className="h-full w-full border-0 bg-white"
              allow="clipboard-read; clipboard-write"
            />
          ) : (
            <PreviewState
              loading={runtimeQuery.isLoading || restarting || session.phase === 'launching'}
              runtimeError={runtimeQuery.isError}
              runtime={runtime}
              sessionError={session.phase === 'error' ? session.reason : undefined}
              onRetry={() => void restart()}
            />
          )}
        </main>
      </DialogContent>
    </Dialog>
  )
}

function PreviewState({
  loading,
  runtimeError,
  runtime,
  sessionError,
  onRetry,
}: {
  loading: boolean
  runtimeError: boolean
  runtime?: ViewRuntime
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
