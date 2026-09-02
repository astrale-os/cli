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
  /** forget a run this client put up itself — see `pendingRun` */
  dropRun: (chatId: string, runId: string) => void
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
  dropRun: (chatId, runId) =>
    set((s) => {
      // guarded by id: a real run that already took this one's place stays
      if (s.runs[chatId]?.id !== runId) return s
      const runs = { ...s.runs }
      delete runs[chatId]
      return { runs }
    }),
  appendEvent: (chatId, runId, event) =>
    set((s) => {
      const cur = s.runs[chatId]
      if (!cur || cur.id !== runId) return s
      if (cur.events.some((e) => e.id === event.id)) return s
      return { runs: { ...s.runs, [chatId]: { ...cur, events: [...cur.events, event] } } }
    }),
}))

/**
 * The turn a submit is about to become, put up from the keystroke.
 *
 * On a free chat a message is a TURN, not a queue entry — but the server takes a
 * moment to say so: it refreshes the domain bundle and probes the harness before
 * it answers, and a message that waits for all that reads as an Enter nobody
 * caught. So the conversation shows the turn straight away, and the server's own
 * copy replaces it the moment it lands.
 *
 * It is the one run here the server has never seen: a submit that fails takes it
 * back with `dropRun`, and the message goes back to the composer.
 */
export function pendingRun(input: {
  id: string
  chatId: string
  harness: string
  /** what was typed; empty when the turn only carries documents and threads */
  message: string
  summary: string
}): AgentRun {
  return {
    id: input.id,
    chatId: input.chatId,
    harness: input.harness,
    // not `running`: nothing runs until the server says it reserved the chat
    status: 'queued',
    createdAt: new Date().toISOString(),
    summary: input.summary,
    ...(input.message ? { instruction: input.message } : {}),
    targetCommentIds: [],
    events: [],
  }
}

/**
 * Whether Studio has reached the agent behind a chat yet.
 *
 * Two states were one too few. `available` answers "did the ACP handshake
 * succeed", and a missing answer read as a NO — so for the seconds the
 * handshake takes (spawn the agent server, negotiate the protocol, up to its
 * own 30s timeout) the composer said the agent was unavailable, in the very
 * words it uses for an agent that is genuinely not installed. Waiting is not
 * failing, and the one place you write to the agent has to say which of the two
 * it is doing.
 */
export type HarnessLink = 'connecting' | 'ready' | 'unreachable'

export function harnessLink(available: boolean | undefined, failed = false): HarnessLink {
  if (available !== undefined) return available ? 'ready' : 'unreachable'
  // no snapshot: still on the wire, unless the read itself gave up — then nothing
  // more is coming and saying "connecting" would be a spinner that never stops
  return failed ? 'unreachable' : 'connecting'
}

/** Initial snapshot for one chat (harness availability + most-recent run). */
export function useAgentSnapshot(chatId?: string) {
  const active = useActiveChatId()
  const chat = chatId ?? active
  return useQuery({
    queryKey: qk.agent(chat),
    queryFn: () => api.agentSnapshot(chat),
    enabled: !!chat,
    // The SSE stream is how a finished turn normally lands, and it has no replay:
    // a frame emitted while the socket was down is gone for good. While the SERVER
    // still says a turn is in flight, keep asking — otherwise the one frame that
    // says "it stopped" is the one the composer waits on forever.
    //
    // And keep asking while the agent is OUT of reach: the handshake is retried
    // by asking again, so an agent that comes up on its own — a login that
    // landed, an install that finished, a harness restarted — reaches the
    // composer without anyone reloading the page.
    refetchInterval: (query) => {
      const snapshot = query.state.data
      if (isRunActive(snapshot?.run)) return 5_000
      return snapshot?.available ? false : 15_000
    },
  })
}

/** One chat's conversation: past turns from disk, with the live one appended. */
export function useAgentTurns(chatId?: string): AgentRun[] {
  const active = useActiveChatId()
  const chat = chatId ?? active
  const history = useQuery({
    queryKey: qk.agentHistory(chat),
    queryFn: () => api.agentHistory(chat),
    enabled: !!chat,
  })
  const current = useDisplayRun(chat)
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
export function useDisplayRun(chatId?: string): AgentRun | null {
  const active = useActiveChatId()
  const chat = chatId ?? active
  const live = useAgentLive((s) => (chat ? s.runs[chat] : undefined))
  const snap = useAgentSnapshot(chat)
  const stored = snap.data?.run ?? null
  return useMemo(() => reconcileRun(live, stored), [live, stored])
}

export function isRunActive(run: AgentRun | null | undefined): boolean {
  return run?.status === 'running' || run?.status === 'queued'
}
