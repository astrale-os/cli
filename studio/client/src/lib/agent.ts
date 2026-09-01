/**
 * agent.ts — client state for the live agent loop, one entry per CHAT.
 *
 * The authoritative run lives on the server; here we mirror it: seed from
 * GET /agent (react-query), then keep it fresh from the SSE stream (`agent-run`
 * replaces the run, `agent-event` appends one activity event). Tabs run
 * independently, so the mirror is keyed by chat id — a turn streaming into a
 * background tab must not overwrite what the foreground one shows.
 */
import type { AgentEvent, AgentRun } from '@shared/types'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { create } from 'zustand'

import { api, qk } from './api'
import { useActiveChatId } from './chats'

interface AgentLiveState {
  /** the active-or-latest run per chat, mirrored from SSE */
  runs: Record<string, AgentRun>
  setRun: (run: AgentRun) => void
  appendEvent: (chatId: string, runId: string, event: AgentEvent) => void
}

const TERMINAL: Record<AgentRun['status'], number> = {
  queued: 0,
  running: 1,
  succeeded: 2,
  failed: 2,
  canceled: 2,
  interrupted: 2,
}

const NO_RUNS: AgentRun[] = []

export const useAgentLive = create<AgentLiveState>((set) => ({
  runs: {},
  // merge-forward: the HTTP submit response and the SSE stream race; never let an
  // earlier snapshot of the SAME run regress the event list or the terminal status.
  setRun: (run) =>
    set((s) => {
      const cur = s.runs[run.chatId]
      if (cur && cur.id === run.id) {
        const events = run.events.length >= cur.events.length ? run.events : cur.events
        const status = TERMINAL[run.status] >= TERMINAL[cur.status] ? run.status : cur.status
        return { runs: { ...s.runs, [run.chatId]: { ...cur, ...run, events, status } } }
      }
      return { runs: { ...s.runs, [run.chatId]: run } }
    }),
  appendEvent: (chatId, runId, event) =>
    set((s) => {
      const cur = s.runs[chatId]
      if (!cur || cur.id !== runId) return s
      if (cur.events.some((e) => e.id === event.id)) return s
      return { runs: { ...s.runs, [chatId]: { ...cur, events: [...cur.events, event] } } }
    }),
}))

/** Initial snapshot for one chat (harness availability + most-recent run). */
export function useAgentSnapshot(id?: string, chatId?: string) {
  const active = useActiveChatId(id)
  const chat = chatId ?? active
  return useQuery({
    queryKey: qk.agent(id ?? '', chat),
    queryFn: () => api.agentSnapshot(id!, chat),
    enabled: !!id && !!chat,
    // The SSE stream is how a finished turn normally lands, and it has no replay:
    // a frame emitted while the socket was down is gone for good. While the SERVER
    // still says a turn is in flight, keep asking — otherwise the one frame that
    // says "it stopped" is the one the composer waits on forever.
    refetchInterval: (query) => (isRunActive(query.state.data?.run) ? 5_000 : false),
  })
}

/** One chat's conversation: past turns from disk, with the live one appended. */
export function useAgentTurns(domainId?: string, chatId?: string): AgentRun[] {
  const active = useActiveChatId(domainId)
  const chat = chatId ?? active
  const history = useQuery({
    queryKey: qk.agentHistory(domainId ?? '', chat),
    queryFn: () => api.agentHistory(domainId!, chat),
    enabled: !!domainId && !!chat,
  })
  const current = useDisplayRun(domainId, chat)
  const past = history.data ?? NO_RUNS
  return useMemo(() => {
    if (!current) return past
    // the live run replaces its own stored copy — it is always the fresher one
    return [...past.filter((run) => run.id !== current.id), current]
  }, [current, past])
}

/**
 * Reconcile the SSE mirror against the server's own answer.
 *
 * The mirror is ahead on EVENTS — it collects them frame by frame — but it is
 * only ever as right about STATUS as the last frame that reached it. Miss the
 * one that says `canceled` (socket down, tab asleep, server restarted) and the
 * mirror keeps claiming a turn is running, which leaves the composer showing
 * Stop with no way back. So status comes from whichever copy got further, and a
 * terminal one is final.
 */
export function reconcileRun(live: AgentRun | undefined, stored: AgentRun | null): AgentRun | null {
  if (!live) return stored
  if (!stored) return live
  // different turns: the newer one is what this chat is doing now — the mirror
  // holds a just-submitted run before the snapshot has caught up, and the
  // snapshot holds another window's run before the stream delivers it
  if (stored.id !== live.id)
    return Date.parse(stored.createdAt) > Date.parse(live.createdAt) ? stored : live
  return {
    ...live,
    ...stored,
    status: TERMINAL[stored.status] > TERMINAL[live.status] ? stored.status : live.status,
    events: live.events.length >= stored.events.length ? live.events : stored.events,
  }
}

/** The run to display for a chat: the live (SSE) copy, corrected by the server. */
export function useDisplayRun(domainId?: string, chatId?: string): AgentRun | null {
  const active = useActiveChatId(domainId)
  const chat = chatId ?? active
  const live = useAgentLive((s) => (chat ? s.runs[chat] : undefined))
  const snap = useAgentSnapshot(domainId, chat)
  const stored = snap.data?.run ?? null
  return useMemo(() => reconcileRun(live, stored), [live, stored])
}

export function isRunActive(run: AgentRun | null | undefined): boolean {
  return run?.status === 'running' || run?.status === 'queued'
}
