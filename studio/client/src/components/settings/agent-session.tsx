import type { HarnessStatus } from '@shared/types'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { useActiveChat } from '@/lib/chats'
import { useAgentSession } from '@/lib/hooks'

import { SettingsHint } from './hint'

/** Manual conversation ownership for the chat the user is in, and only that one. */
export function AgentSession({ harness }: { harness?: HarnessStatus }) {
  const chat = useActiveChat()
  const { data: session, isFetching } = useAgentSession(chat?.id)
  const queryClient = useQueryClient()
  const [sessionId, setSessionId] = useState('')
  // The id is only meaningful to the chat's OWN agent, which never changes.
  const chatHarness = chat?.harness ?? harness?.id

  useEffect(() => {
    if (!chatHarness || isFetching) {
      setSessionId('')
      return
    }
    setSessionId(session?.sessionId ?? '')
  }, [chatHarness, isFetching, session?.sessionId])

  const save = useMutation({
    mutationFn: (input: { harness: string; sessionId: string; chatId?: string }) =>
      api.setAgentSession(input.harness, input.sessionId, input.chatId),
    onSuccess: (saved, input) => {
      queryClient.setQueryData(qk.agentSession(input.chatId), saved)
      queryClient.invalidateQueries({ queryKey: qk.agent() })
      queryClient.invalidateQueries({ queryKey: qk.chats })
      toast.success(saved.sessionId ? 'Agent session changed' : 'Agent session cleared')
    },
    onError: (error) => toast.error(String(error)),
  })

  return (
    <div className="space-y-1.5 px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[13px]">
        <span>Session ID</span>
        <SettingsHint text="This chat's resumable conversation id. Paste another to resume that conversation; clear it to start fresh on the next turn. Cannot be changed while its turn is running." />
        {session && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {session.sessionId
              ? `${session.turns} turn${session.turns === 1 ? '' : 's'}${chatHarness ? ` · ${chatHarness}` : ''}`
              : 'no active conversation'}
          </span>
        )}
      </span>
      <input
        value={sessionId}
        onChange={(event) => setSessionId(event.target.value)}
        placeholder="none — a fresh conversation starts next turn"
        spellCheck={false}
        className="w-full rounded-md border bg-card px-2 py-1 font-mono text-[12px] outline-none focus:border-primary"
      />
      <div className="flex justify-end">
        <button
          type="button"
          disabled={
            !chatHarness ||
            isFetching ||
            sessionId.trim() === (session?.sessionId ?? '') ||
            save.isPending
          }
          onClick={() =>
            save.mutate({
              harness: chatHarness!,
              sessionId: sessionId.trim(),
              ...(chat ? { chatId: chat.id } : {}),
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
