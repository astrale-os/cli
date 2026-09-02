/**
 * chats.ts — client state for the machine's chat tabs.
 *
 * The server owns the list and which tab is active (they persist across
 * restarts), so everything here is a mirror of `GET /agent/chats` plus the
 * mutations that move it. The one rule the UI must not paper over: a chat's
 * harness is fixed, so "switch to the other agent" is a fork that opens a NEW
 * tab and leaves the current conversation alone.
 */
import type { ChatInfo, ChatList } from '@shared/types'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, qk } from './api'
import { useSchemaSettled } from './hooks'

const NO_CHATS: ChatInfo[] = []

export function useChats() {
  return useQuery({
    queryKey: qk.chats,
    queryFn: api.chats,
  })
}

export function useChatList(): ChatInfo[] {
  return useChats().data?.chats ?? NO_CHATS
}

/** The tab the user is looking at — undefined only until the first load lands. */
export function useActiveChatId(): string | undefined {
  return useChats().data?.activeId || undefined
}

export function useActiveChat(): ChatInfo | undefined {
  const { data } = useChats()
  return data?.chats.find((chat) => chat.id === data.activeId)
}

export function chatOf(chats: ChatInfo[], chatId?: string): ChatInfo | undefined {
  return chats.find((chat) => chat.id === chatId)
}

/** Every way the tab strip can change, each landing the server's own answer. */
export function useChatMutations() {
  const queryClient = useQueryClient()
  const setList = (list: ChatList) => queryClient.setQueryData(qk.chats, list)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.chats })
    void queryClient.invalidateQueries({ queryKey: qk.agent() })
  }
  const focus = (chat: ChatInfo) => {
    // The server already made the new tab active; mirror that without a round trip.
    const current = queryClient.getQueryData<ChatList>(qk.chats)
    if (current)
      setList({
        chats: [...current.chats.filter((entry) => entry.id !== chat.id), chat],
        activeId: chat.id,
      })
    refresh()
  }

  const open = useMutation({
    mutationFn: (harness?: string) => api.openChat(harness),
    onSuccess: focus,
    onError: (error) => toast.error(`Could not open a chat — ${String(error)}`),
  })
  const select = useMutation({
    mutationFn: (chatId: string) => api.selectChat(chatId),
    onSuccess: setList,
    onError: (error) => toast.error(String(error)),
  })
  const close = useMutation({
    mutationFn: (chatId: string) => api.closeChat(chatId),
    onSuccess: (list) => {
      setList(list)
      refresh()
    },
    onError: (error) => toast.error(`Could not close the chat — ${String(error)}`),
  })
  const update = useMutation({
    mutationFn: (input: { chatId: string; title?: string; model?: string; effort?: string }) =>
      api.updateChat(input.chatId, {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.effort === undefined ? {} : { effort: input.effort }),
      }),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(String(error)),
  })
  const switchHarness = useMutation({
    mutationFn: (input: { chatId: string; harness: string; model?: string }) =>
      api.switchChatHarness(input.chatId, input.harness, input.model),
    onSuccess: (chat) => {
      focus(chat)
      toast.success('New chat — the previous conversation was summarized for it, and stays open')
    },
    onError: (error) => toast.error(`Could not switch agent — ${String(error)}`),
  })
  const forgetOrigin = useMutation({
    mutationFn: (chatId: string) => api.forgetChatOrigin(chatId),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(`Could not delete the transferred context — ${String(error)}`),
  })

  return { open, select, close, update, switchHarness, forgetOrigin }
}

/**
 * Every harness's models — one live ACP probe of each, warmed for the workspace.
 *
 * It used to wait for the picker to be opened, on the grounds that probing every
 * agent is expensive. That paid for itself twice over: the composer's label IS
 * the catalog (an unpinned chat runs its harness's default model, and only this
 * knows which), so a panel opened before the answer landed had no model to name.
 * One probe per workspace visit buys a composer that opens already saying it —
 * `WorkPanel` starts it while you are still looking at the graph.
 *
 * Behind the canvas, though, exactly like the loadout beside it: this is the
 * heaviest read in the studio — an ACP session per installed agent — and the
 * schema must not queue behind it for a picker nobody has opened yet.
 */
export function useModelCatalog() {
  const settled = useSchemaSettled()
  return useQuery({
    queryKey: qk.models,
    queryFn: api.models,
    enabled: settled,
    staleTime: 60_000,
  })
}
