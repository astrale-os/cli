import type { HarnessStatus } from '@shared/types'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { useAgentSession } from '@/lib/hooks'

import { SettingsHint } from './hint'

/** Manual conversation ownership and persistence for the selected harness only. */
export function AgentSession({
  domainId,
  harness,
}: {
  domainId?: string
  harness?: HarnessStatus
}) {
  const { data: session, isFetching } = useAgentSession(domainId)
  const queryClient = useQueryClient()
  const [sessionId, setSessionId] = useState('')
  const matchesHarness = !session?.harness || session.harness === harness?.id

  useEffect(() => {
    if (!domainId || !harness || isFetching || !matchesHarness) {
      setSessionId('')
      return
    }
    setSessionId(session?.sessionId ?? '')
  }, [domainId, harness?.id, isFetching, matchesHarness, session?.harness, session?.sessionId])

  const save = useMutation({
    mutationFn: (input: { domainId: string; harness: string; sessionId: string }) =>
      api.setAgentSession(input.domainId, input.harness, input.sessionId),
    onSuccess: (saved, input) => {
      queryClient.setQueryData(qk.agentSession(input.domainId), saved)
      queryClient.invalidateQueries({ queryKey: qk.agent(input.domainId) })
      toast.success(saved.sessionId ? 'Agent session changed' : 'Agent session cleared')
    },
    onError: (error) => toast.error(String(error)),
  })

  return (
    <div className="space-y-1.5 px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[13px]">
        <span>Session ID</span>
        <SettingsHint text="The agent's resumable conversation id. Paste another to resume that conversation; clear it to start fresh on the next turn. Cannot be changed while a turn is running." />
        {session && (
          <span className="ml-auto text-[11px] text-muted-foreground/60">
            {session.sessionId
              ? `${session.turns} turn${session.turns === 1 ? '' : 's'}${session.harness ? ` · ${session.harness}` : ''}`
              : 'no active conversation'}
          </span>
        )}
      </span>
      <input
        value={sessionId}
        onChange={(event) => setSessionId(event.target.value)}
        placeholder="(none — a fresh conversation starts next turn)"
        spellCheck={false}
        className="w-full rounded-md border bg-background px-2 py-1 font-mono text-[12px] outline-none focus:border-primary"
      />
      <div className="flex justify-end">
        <button
          type="button"
          disabled={
            !domainId ||
            !harness ||
            isFetching ||
            !matchesHarness ||
            sessionId.trim() === (session?.sessionId ?? '') ||
            save.isPending
          }
          onClick={() =>
            save.mutate({
              domainId: domainId!,
              harness: harness!.id,
              sessionId: sessionId.trim(),
            })
          }
          className="rounded-md px-2.5 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
        >
          {save.isPending ? 'Applying…' : 'Apply session'}
        </button>
      </div>
    </div>
  )
}
