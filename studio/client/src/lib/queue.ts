/**
 * queue.ts — client state for the messages waiting behind a running turn.
 *
 * The queue lives on the chat, server-side, for the same reason the tab strip
 * does: it survives a reload, and two windows on the same domain see one queue
 * rather than two. So there is no local list here — every call answers with the
 * tab as the server now holds it, and that copy is landed straight into the
 * chats query instead of refetching a list the queue was the only change to.
 */
import type { ChatInfo, ChatList } from '@shared/types'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAgentLive } from './agent'
import { api, qk } from './api'

/** Replace one tab in the cached strip, leaving the others exactly as they were. */
export function landChat(chats: ChatList | undefined, chat: ChatInfo): ChatList | undefined {
  if (!chats) return chats
  return {
    ...chats,
    chats: chats.chats.map((entry) => (entry.id === chat.id ? chat : entry)),
  }
}

/** Everything you can do to a message that has not been sent yet. */
export function useQueueMutations(domainId?: string, chatId?: string) {
  const queryClient = useQueryClient()
  const setRun = useAgentLive((state) => state.setRun)
  const land = (chat: ChatInfo) =>
    queryClient.setQueryData<ChatList>(qk.chats(domainId ?? ''), (current) =>
      landChat(current, chat),
    )

  const edit = useMutation({
    mutationFn: (input: { messageId: string; text: string }) =>
      api.editQueued(domainId!, chatId!, input.messageId, input.text),
    onSuccess: land,
    onError: (error) => toast.error(`Could not edit the queued message — ${String(error)}`),
  })
  const remove = useMutation({
    mutationFn: (messageId: string) => api.removeQueued(domainId!, chatId!, messageId),
    onSuccess: land,
    onError: (error) => toast.error(`Could not delete the queued message — ${String(error)}`),
  })
  const move = useMutation({
    mutationFn: (input: { messageId: string; direction: 'up' | 'down' }) =>
      api.moveQueued(domainId!, chatId!, input.messageId, input.direction),
    onSuccess: land,
    onError: (error) => toast.error(`Could not reorder the queue — ${String(error)}`),
  })
  // Promoting stops the turn in progress, so both the conversation and the strip
  // move at once — neither is derivable from the run this call answers with.
  const sendNow = useMutation({
    mutationFn: (messageId: string) => api.sendQueued(domainId!, chatId!, messageId),
    onSuccess: (result) => {
      if (result.run) setRun(result.run)
      void queryClient.invalidateQueries({ queryKey: qk.agent(domainId ?? '', chatId) })
      void queryClient.invalidateQueries({ queryKey: qk.chats(domainId ?? '') })
    },
    onError: (error) => toast.error(`Could not send that message now — ${String(error)}`),
  })

  return { edit, remove, move, sendNow }
}
