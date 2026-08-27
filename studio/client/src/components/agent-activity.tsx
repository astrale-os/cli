/**
 * agent-activity.tsx — the live agent loop UI. `AgentSubmitButton` replaces the
 * copy/paste ritual: it sends the open threads to a local agent. `AgentActivityDrawer`
 * is the slide-over that streams what the agent is doing (thinking, edits, commands,
 * replies) in real time. Thread replies land back in the Comments section by
 * themselves (server merges them and pushes a `comments` SSE).
 */
import type { AgentEvent, AgentPromptSnapshot, AgentRun } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  CornerDownLeft,
  FileEdit,
  History,
  Loader2,
  MessageSquare,
  Play,
  RotateCcw,
  Activity,
  Send,
  Ellipsis,
  Terminal,
  Wrench,
  X,
} from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { isRunActive, useAgentLive, useAgentSnapshot, useDisplayRun } from '@/lib/agent'
import { api, qk } from '@/lib/api'
import { useComments } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { Markdown } from './markdown'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { ScrollArea } from './ui/misc'

/** open threads whose last entry isn't the agent — the ones a submit would answer */
function useAwaitingCount(domainId?: string): number {
  const { data } = useComments(domainId)
  return (data?.comments ?? []).filter(
    (c) => c.status === 'open' && c.thread.at(-1)?.role !== 'author',
  ).length
}

/** Compact elapsed duration: 3s · 1m 23s · 1h 04m. */
function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  if (m < 60) return `${m}m ${String(total % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** Elapsed since `startIso`, ticking each second WHILE active, then frozen at
 *  `endIso`. Timestamp-based (not tick-accumulated), so it stays correct across a
 *  backgrounded tab and never drifts. */
function useElapsedMs(startIso?: string, endIso?: string, active?: boolean): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  if (!startIso) return null
  const start = Date.parse(startIso)
  if (Number.isNaN(start)) return null
  const end = active ? now : endIso ? Date.parse(endIso) : now
  return Math.max(0, end - start)
}

/** The run's working time — live while running ("since the message was sent"),
 *  then the frozen total once done. Isolated so its per-second tick re-renders
 *  only this label, not the streaming timeline around it. */
function RunElapsed({ run, className }: { run?: AgentRun | null; className?: string }) {
  const active = isRunActive(run)
  const ms = useElapsedMs(run?.createdAt, run?.finishedAt, active)
  if (ms == null) return null
  return (
    <span
      className={cn('tabular-nums', className)}
      title={active ? 'Working time so far' : 'Total run time'}
    >
      {formatDuration(ms)}
    </span>
  )
}

export function AgentSubmitButton() {
  const domainId = useUI((s) => s.domainId)
  const snap = useAgentSnapshot(domainId)
  const run = useDisplayRun(domainId)
  const setRun = useAgentLive((s) => s.setRun)
  const setDrawer = useAgentLive((s) => s.setDrawer)
  const awaiting = useAwaitingCount(domainId)
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()

  const active = isRunActive(run)
  const available = snap.data?.available ?? false

  const submit = async () => {
    if (!domainId) return
    setBusy(true)
    try {
      const r = await api.agentSubmit(domainId)
      if ((r as any).error) {
        toast.error((r as any).error)
      } else {
        setRun(r as AgentRun)
        toast.success('Sent to the agent')
      }
    } catch (e) {
      toast.error(String(e))
    } finally {
      setBusy(false)
      qc.invalidateQueries({ queryKey: qk.agent(domainId) })
    }
  }

  if (active) {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setDrawer(true)}
        title="Show agent activity — running time so far"
      >
        <Loader2 className="h-4 w-4 animate-spin" /> Agent working…
        <RunElapsed run={run} className="ml-0.5 text-[11px] font-normal text-muted-foreground" />
      </Button>
    )
  }

  // Keep the button live whenever the harness is available — don't gate on the
  // awaiting count (it lags a freshly-added comment by one query refetch, which
  // made Submit feel like a silent no-op). An empty submit just toasts.
  const disabled = busy || !available
  const title = !available
    ? `${snap.data?.harness ?? 'agent'} not available — set DOMAIN_STUDIO_HARNESS or install the CLI`
    : awaiting === 0
      ? 'No open threads awaiting a reply yet'
      : `Send ${awaiting} open thread${awaiting === 1 ? '' : 's'} to the agent`

  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" onClick={submit} disabled={disabled} title={title}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit
        to agent
        {awaiting > 0 && (
          <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[10px] font-semibold">
            {awaiting}
          </span>
        )}
      </Button>
      {run && (
        <Button size="icon" variant="ghost" onClick={() => setDrawer(true)} title="Agent activity">
          <Activity className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

function eventVisual(e: AgentEvent): { icon: React.ReactNode; tone: string } {
  switch (e.kind) {
    case 'message':
      return { icon: <MessageSquare className="h-3.5 w-3.5" />, tone: 'text-primary' }
    case 'thinking':
      return { icon: <Ellipsis className="h-3.5 w-3.5" />, tone: 'text-muted-foreground' }
    case 'reply':
      return { icon: <CornerDownLeft className="h-3.5 w-3.5" />, tone: 'text-success' }
    case 'error':
      return { icon: <AlertTriangle className="h-3.5 w-3.5" />, tone: 'text-destructive' }
    case 'tool': {
      const t = e.tool ?? ''
      if (t === 'Edit' || t === 'Write' || t === 'MultiEdit')
        return { icon: <FileEdit className="h-3.5 w-3.5" />, tone: 'text-warning' }
      if (t === 'Bash')
        return { icon: <Terminal className="h-3.5 w-3.5" />, tone: 'text-foreground/80' }
      return { icon: <Wrench className="h-3.5 w-3.5" />, tone: 'text-muted-foreground' }
    }
    default:
      return {
        icon: <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />,
        tone: 'text-muted-foreground',
      }
  }
}

// memoized: an appended event creates a new events array, so without memo every
// existing row re-renders on each new frame (O(n²) over a streaming run). Events
// are immutable per id, so memo is safe.
/** Compact tokens label: 980 · 12.3k · 1.4M */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

const EventRow = memo(function EventRow({ e }: { e: AgentEvent }) {
  const { icon, tone } = eventVisual(e)
  const isThinking = e.kind === 'thinking'
  return (
    <div className="flex gap-2.5 px-4 py-2">
      <div className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center', tone)}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        {e.kind === 'tool' ? (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
            <span className="font-medium text-foreground/80">{e.tool}</span>
            {e.target && (
              <span className="truncate font-mono text-xs text-muted-foreground">{e.target}</span>
            )}
          </div>
        ) : e.kind === 'message' || e.kind === 'reply' ? (
          <Markdown text={e.text} />
        ) : (
          <p
            className={cn(
              'whitespace-pre-wrap break-words text-[13px] leading-relaxed',
              isThinking ? 'italic text-muted-foreground' : 'text-foreground/80',
            )}
          >
            {e.text}
          </p>
        )}
      </div>
    </div>
  )
})

const STATUS_TONE: Record<AgentRun['status'], string> = {
  queued: 'warning',
  running: 'warning',
  succeeded: 'success',
  failed: 'destructive',
  canceled: 'muted',
  interrupted: 'warning',
}

function PromptBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <pre className="max-h-[36vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/35 p-3 font-mono text-[11px] leading-relaxed">
        {text}
      </pre>
    </div>
  )
}

function SentPromptDialog({
  prompt,
  onClose,
}: {
  prompt: AgentPromptSnapshot
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Prompt sent to agent</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>{prompt.firstTurn ? 'new session' : 'follow-up turn'}</span>
          <span>{prompt.resumed ? 'resumed' : 'fresh'}</span>
          {prompt.model && <span className="font-mono">model {prompt.model}</span>}
          {prompt.effort && <span>effort {prompt.effort}</span>}
          <span>{new Date(prompt.createdAt).toLocaleString()}</span>
          {prompt.sessionId && <span className="font-mono">session {prompt.sessionId}</span>}
          {prompt.mcpTools.length > 0 && <span>bridge tools: {prompt.mcpTools.join(', ')}</span>}
        </div>
        <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
          <PromptBlock title="Turn prompt (stdin)" text={prompt.turnPrompt} />
          <PromptBlock
            title="System appendix (--append-system-prompt)"
            text={prompt.systemPrompt}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AgentActivityDrawer() {
  const open = useAgentLive((s) => s.drawerOpen)
  const setDrawer = useAgentLive((s) => s.setDrawer)
  const domainId = useUI((s) => s.domainId)
  const setPanelTab = useUI((s) => s.setPanelTab)
  const run = useDisplayRun(domainId)
  const snap = useAgentSnapshot(domainId)
  const setRun = useAgentLive((s) => s.setRun)
  const qc = useQueryClient()
  const [cancelling, setCancelling] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const active = isRunActive(run)
  const events = run?.events ?? []
  const conversation = snap.data?.conversation
  const turns = conversation?.turns ?? 0

  // Forget the resumable conversation — the next submit starts fresh (no memory of
  // prior turns). Refused server-side mid-run; disabled here too.
  const resetConversation = async () => {
    if (!domainId || resetting || active) return
    setResetting(true)
    try {
      const r = await api.agentReset(domainId)
      if (r.ok)
        toast.success('Started a fresh conversation — the next submit won’t remember earlier turns')
      else toast.error('Could not reset — a run may be in progress')
    } catch (e) {
      toast.error(String(e))
    } finally {
      setResetting(false)
      qc.invalidateQueries({ queryKey: qk.agent(domainId) })
    }
  }

  // Seamless continue after a studio-restart interruption: re-enter the SAME session
  // with a bare "pick up where you left off" nudge — no threads/context re-sent.
  const resume = async () => {
    if (!domainId || resuming || active) return
    setResuming(true)
    try {
      const r = await api.agentResume(domainId)
      if ((r as any).error) toast.error((r as any).error)
      else {
        setRun(r as AgentRun)
        toast.success('Resuming where the agent left off')
      }
    } catch (e) {
      toast.error(String(e))
    } finally {
      setResuming(false)
      qc.invalidateQueries({ queryKey: qk.agent(domainId) })
    }
  }

  // auto-scroll to the newest event while running
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [events.length, open])

  // a run terminates by SSE, not by the cancel ack — keep the button disabled from
  // first click until the run actually leaves running (the button then unmounts).
  // Reset per run so the next run's button is live.
  useEffect(() => setCancelling(false), [run?.id])
  const cancel = async () => {
    if (!domainId || cancelling) return
    setCancelling(true)
    try {
      await api.agentCancel(domainId)
      toast.message('Cancelling the agent…')
    } catch {
      setCancelling(false)
    }
  }

  // Esc closes the drawer (it's non-modal — the rest of the studio stays usable
  // while the agent works, which can take minutes).
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawer(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, setDrawer])

  if (!open) return null

  return (
    <>
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-[92vw] flex-col border-l bg-card shadow-2xl">
        {/* header */}
        <div className="flex items-center gap-2.5 border-b px-4 h-14 shrink-0">
          <div
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg',
              active ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary',
            )}
          >
            {active ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Activity className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              Agent
              <span className="text-xs font-normal text-muted-foreground">
                {snap.data?.harness ?? run?.harness}
              </span>
            </div>
          </div>
          {run && (
            <Badge variant={STATUS_TONE[run.status] as any} className="ml-1 capitalize">
              {run.status}
            </Badge>
          )}
          {run && <RunElapsed run={run} className="text-[11px] text-muted-foreground" />}
          {run?.prompt && (
            <button
              type="button"
              onClick={() => setPromptOpen(true)}
              className="ml-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Show the exact prompt sent to the local agent"
            >
              Sent prompt
            </button>
          )}
          <button
            type="button"
            onClick={() => setDrawer(false)}
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* conversation continuity — one resumable session per domain across submits */}
        {conversation?.active && (
          <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground shrink-0">
            <History className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="min-w-0 truncate">
              Conversation · {turns} turn{turns === 1 ? '' : 's'}
              <span className="opacity-60"> · the agent remembers earlier turns</span>
            </span>
            <button
              type="button"
              onClick={resetConversation}
              disabled={active || resetting}
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground disabled:opacity-40"
              title="Start a fresh conversation — the next submit won't remember earlier turns"
            >
              {resetting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RotateCcw className="h-3 w-3" />
              )}{' '}
              Start fresh
            </button>
          </div>
        )}

        {/* timeline */}
        <ScrollArea className="flex-1 min-h-0">
          <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden py-1.5">
            {!run ? (
              <div className="px-4 py-16 text-center text-sm text-muted-foreground">
                No agent run yet. Add a comment and press{' '}
                <span className="font-medium text-foreground">Submit to agent</span>.
              </div>
            ) : events.length === 0 ? (
              <div className="px-4 py-16 text-center text-sm text-muted-foreground">
                Starting the agent…
              </div>
            ) : (
              <div className="divide-y divide-border">
                {events.map((e) => (
                  <EventRow key={e.id} e={e} />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* footer */}
        <div className="border-t px-4 py-3 shrink-0">
          {active ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Editing your domain…</span>
              <Button size="sm" variant="outline" onClick={cancel} disabled={cancelling}>
                {cancelling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}{' '}
                Cancel
              </Button>
            </div>
          ) : run ? (
            <div className="flex items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                {run.status === 'canceled' ? (
                  <span className="text-muted-foreground">canceled — stopped before finishing</span>
                ) : run.status === 'interrupted' ? (
                  <span className="text-warning">
                    Interrupted by a studio restart — conversation intact.
                  </span>
                ) : run.status === 'failed' ? (
                  <span className="text-destructive">{run.error ?? 'failed'}</span>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5 text-success" />
                    {[
                      run.liveReplies ? `${run.liveReplies} live` : '',
                      run.merge && (run.merge.merged || run.merge.closed)
                        ? `merged ${run.merge.merged}, closed ${run.merge.closed}`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'done'}
                  </>
                )}
                {run.merge?.schemaMismatch && (
                  <span className="text-warning">⚠ replied against an older schema</span>
                )}
                {run.merge && run.merge.unknownIds.length > 0 && (
                  <span className="text-warning">
                    ⚠ {run.merge.unknownIds.length} unknown id(s)
                  </span>
                )}
                {typeof run.tokens === 'number' && run.tokens > 0 && (
                  <span className="opacity-60">· {fmtTokens(run.tokens)} tokens</span>
                )}
              </span>
              {run.status === 'interrupted' ? (
                <Button
                  size="sm"
                  onClick={resume}
                  disabled={resuming}
                  title="Continue the agent from where it was interrupted"
                >
                  {resuming ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}{' '}
                  Resume
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDrawer(false)
                    setPanelTab('comments')
                  }}
                >
                  <MessageSquare className="h-3.5 w-3.5" /> View replies
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </aside>
      {promptOpen && run?.prompt && (
        <SentPromptDialog prompt={run.prompt} onClose={() => setPromptOpen(false)} />
      )}
    </>
  )
}
