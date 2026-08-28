/**
 * agent.ts — client state for the live agent loop. The authoritative run lives
 * on the server; here we mirror it: seed from GET /agent (react-query), then keep
 * it fresh from the SSE stream (`agent-run` replaces the run, `agent-event`
 * appends one activity event). The work panel + submit button read this.
 */
import type { AgentEvent, AgentRun } from '@shared/types'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { create } from 'zustand'

import { api, qk } from './api'

interface AgentLiveState {
  /** the active-or-latest run per domain, mirrored from SSE */
  runs: Record<string, AgentRun>
  setRun: (run: AgentRun) => void
  appendEvent: (domainId: string, runId: string, event: AgentEvent) => void
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
      const cur = s.runs[run.domainId]
      if (cur && cur.id === run.id) {
        const events = run.events.length >= cur.events.length ? run.events : cur.events
        const status = TERMINAL[run.status] >= TERMINAL[cur.status] ? run.status : cur.status
        return { runs: { ...s.runs, [run.domainId]: { ...cur, ...run, events, status } } }
      }
      return { runs: { ...s.runs, [run.domainId]: run } }
    }),
  appendEvent: (domainId, runId, event) =>
    set((s) => {
      const cur = s.runs[domainId]
      if (!cur || cur.id !== runId) return s
      if (cur.events.some((e) => e.id === event.id)) return s
      return { runs: { ...s.runs, [domainId]: { ...cur, events: [...cur.events, event] } } }
    }),
}))

/** Initial snapshot (harness availability + most-recent run). */
export function useAgentSnapshot(id?: string) {
  return useQuery({
    queryKey: qk.agent(id ?? ''),
    queryFn: () => api.agentSnapshot(id!),
    enabled: !!id,
  })
}

/** The conversation: past turns from disk, with the live one appended. */
export function useAgentTurns(domainId?: string): AgentRun[] {
  const history = useQuery({
    queryKey: qk.agentHistory(domainId ?? ''),
    queryFn: () => api.agentHistory(domainId!),
    enabled: !!domainId,
  })
  const current = useDisplayRun(domainId)
  const past = history.data ?? NO_RUNS
  return useMemo(() => {
    if (!current) return past
    // the live run replaces its own stored copy — it is always the fresher one
    return [...past.filter((run) => run.id !== current.id), current]
  }, [current, past])
}

/** The run to display: the live (SSE) copy wins over the fetched snapshot. */
export function useDisplayRun(domainId?: string): AgentRun | null {
  const live = useAgentLive((s) => (domainId ? s.runs[domainId] : undefined))
  const snap = useAgentSnapshot(domainId)
  return live ?? snap.data?.run ?? null
}

export function isRunActive(run: AgentRun | null | undefined): boolean {
  return run?.status === 'running' || run?.status === 'queued'
}
