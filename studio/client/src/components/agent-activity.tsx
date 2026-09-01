/**
 * Header entry point for submitting comment threads to the local agent. The
 * conversation itself lives in the dockable work panel.
 */
import type { AgentRun } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
  harnessLink,
  isRunActive,
  useAgentLive,
  useAgentSnapshot,
  useDisplayRun,
} from '@/lib/agent'
import { api, qk } from '@/lib/api'
import { useComments } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { Button } from './ui/button'

/** Open threads whose last entry isn't the agent — the ones a submit would answer. */
function useAwaitingCount(domainId?: string): number {
  const { data } = useComments(domainId)
  return (data?.comments ?? []).filter(
    (comment) => comment.status === 'open' && comment.thread.at(-1)?.role !== 'author',
  ).length
}

/** Compact elapsed duration: 3s · 1m 23s · 1h 04m. */
function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** Elapsed since `startIso`, ticking each second while active. */
function useElapsedMs(startIso?: string, endIso?: string, active?: boolean): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  if (!startIso) return null
  const start = Date.parse(startIso)
  if (Number.isNaN(start)) return null
  const end = active ? now : endIso ? Date.parse(endIso) : now
  return Math.max(0, end - start)
}

/** Isolate the per-second tick from the rest of the header. */
function RunElapsed({ run, className }: { run?: AgentRun | null; className?: string }) {
  const active = isRunActive(run)
  const elapsed = useElapsedMs(run?.createdAt, run?.finishedAt, active)
  if (elapsed == null) return null
  return (
    <span
      className={cn('tabular-nums', className)}
      title={active ? 'Working time so far' : 'Total run time'}
    >
      {formatDuration(elapsed)}
    </span>
  )
}

export function AgentSubmitButton() {
  const domainId = useUI((state) => state.domainId)
  const openAgentPanel = useUI((state) => state.setPanelTab)
  const snapshot = useAgentSnapshot(domainId)
  const run = useDisplayRun(domainId)
  const setRun = useAgentLive((state) => state.setRun)
  const awaiting = useAwaitingCount(domainId)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()

  const active = isRunActive(run)
  // reaching the agent is an ACP handshake, not a lookup — say so while it runs,
  // rather than blaming a PATH that is probably fine (see `harnessLink`)
  const link = harnessLink(snapshot.data?.available, snapshot.isError)
  const available = link === 'ready'
  const connecting = link === 'connecting'

  const submit = async () => {
    if (!domainId) return
    setBusy(true)
    try {
      const result = await api.agentSubmit(domainId)
      // this button only shows on an idle chat, so a submit either runs or fails
      // — there is no turn for the threads to queue behind
      if (result.error) toast.error(result.error)
      else if (result.run) {
        setRun(result.run)
        toast.success('Sent to the agent')
      }
    } catch (error) {
      toast.error(String(error))
    } finally {
      setBusy(false)
      queryClient.invalidateQueries({ queryKey: qk.agent(domainId) })
    }
  }

  if (active) {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => openAgentPanel('agent')}
        title="Open the agent conversation — running time so far"
      >
        <Loader2 className="h-4 w-4 animate-spin" /> Agent working…
        <RunElapsed run={run} className="ml-0.5 text-[11px] font-normal text-muted-foreground" />
      </Button>
    )
  }

  // Keep the button live whenever the harness is available — don't gate on the
  // awaiting count, which can lag a freshly-added comment by one query refetch.
  const disabled = busy || !available
  const title = connecting
    ? `Connecting to ${snapshot.data?.harness ?? 'the agent'}…`
    : !available
      ? `${snapshot.data?.harness ?? 'agent'} not available — set DOMAIN_STUDIO_HARNESS or install the CLI`
      : awaiting === 0
        ? 'No open threads awaiting a reply yet'
        : `Send ${awaiting} open thread${awaiting === 1 ? '' : 's'} to the agent`

  return (
    <Button size="sm" onClick={submit} disabled={disabled} title={title}>
      {busy || connecting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Send className="h-4 w-4" />
      )}{' '}
      Submit to agent
      {awaiting > 0 && (
        <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[10px] font-semibold">
          {awaiting}
        </span>
      )}
    </Button>
  )
}
