import type { AgentEvent, AgentRun, StudioEvent } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { useAgentLive } from './agent'
import { qk } from './api'
import { useInvalidateDomain } from './hooks'
import { useEventStream } from './sse'
import { useUI } from './store'

export type StudioEventEffect =
  | { type: 'invalidate-domain'; domainId: string }
  | { type: 'invalidate-workspace' }
  | { type: 'invalidate-agent'; domainId: string }
  | { type: 'invalidate-agent-history'; domainId: string }
  | { type: 'append-agent-event'; domainId: string; runId: string; event: AgentEvent }
  | { type: 'synchronize-agent-run'; run: AgentRun }

/** Pure policy table for translating one server event into client synchronizations. */
export function studioEventEffects(
  event: StudioEvent,
  activeDomainId?: string,
): StudioEventEffect[] {
  switch (event.type) {
    case 'hello':
      return activeDomainId
        ? [
            { type: 'invalidate-domain', domainId: activeDomainId },
            { type: 'invalidate-agent', domainId: activeDomainId },
            { type: 'invalidate-agent-history', domainId: activeDomainId },
          ]
        : []
    case 'workspace':
      return [{ type: 'invalidate-workspace' }]
    case 'agent-event':
      return [
        {
          type: 'append-agent-event',
          domainId: event.domainId,
          runId: event.runId,
          event: event.event,
        },
      ]
    case 'agent-run': {
      const effects: StudioEventEffect[] = [
        { type: 'synchronize-agent-run', run: event.run },
        { type: 'invalidate-agent', domainId: event.domainId },
      ]
      if (event.run.status !== 'running' && event.run.status !== 'queued') {
        effects.push({ type: 'invalidate-agent-history', domainId: event.domainId })
      }
      return effects
    }
    case 'schema-diff':
      return [
        { type: 'invalidate-domain', domainId: event.domainId },
        { type: 'invalidate-workspace' },
      ]
    case 'anatomy-diff':
    case 'comments':
    case 'compile-error':
    case 'resolving':
      return [{ type: 'invalidate-domain', domainId: event.domainId }]
  }
}

/** Mount the single app-level SSE subscription and apply the pure policy above. */
export function useStudioEventSync(): void {
  const queryClient = useQueryClient()
  const invalidateDomain = useInvalidateDomain()
  const setRun = useAgentLive((state) => state.setRun)
  const appendEvent = useAgentLive((state) => state.appendEvent)

  const onEvent = useCallback(
    (event: StudioEvent) => {
      for (const effect of studioEventEffects(event, useUI.getState().domainId)) {
        switch (effect.type) {
          case 'invalidate-domain':
            invalidateDomain(effect.domainId)
            break
          case 'invalidate-workspace':
            void queryClient.invalidateQueries({ queryKey: qk.workspace })
            break
          case 'invalidate-agent':
            void queryClient.invalidateQueries({ queryKey: qk.agent(effect.domainId) })
            break
          case 'invalidate-agent-history':
            void queryClient.invalidateQueries({ queryKey: qk.agentHistory(effect.domainId) })
            break
          case 'append-agent-event':
            appendEvent(effect.domainId, effect.runId, effect.event)
            break
          case 'synchronize-agent-run':
            setRun(effect.run)
            break
        }
      }
    },
    [appendEvent, invalidateDomain, queryClient, setRun],
  )

  useEventStream(onEvent)
}
