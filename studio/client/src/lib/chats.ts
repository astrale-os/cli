/**
 * chats.ts — client state for a domain's chat tabs.
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

const NO_CHATS: ChatInfo[] = []

export function useChats(domainId?: string) {
  return useQuery({
    queryKey: qk.chats(domainId ?? ''),
    queryFn: () => api.chats(domainId!),
    enabled: !!domainId,
  })
}

export function useChatList(domainId?: string): ChatInfo[] {
  return useChats(domainId).data?.chats ?? NO_CHATS
}

/** The tab the user is looking at — undefined only until the first load lands. */
export function useActiveChatId(domainId?: string): string | undefined {
  return useChats(domainId).data?.activeId || undefined
}

export function useActiveChat(domainId?: string): ChatInfo | undefined {
  const { data } = useChats(domainId)
  return data?.chats.find((chat) => chat.id === data.activeId)
}

export function chatOf(chats: ChatInfo[], chatId?: string): ChatInfo | undefined {
  return chats.find((chat) => chat.id === chatId)
}

/** Every way the tab strip can change, each landing the server's own answer. */
export function useChatMutations(domainId?: string) {
  const queryClient = useQueryClient()
  const setList = (list: ChatList) => queryClient.setQueryData(qk.chats(domainId ?? ''), list)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.chats(domainId ?? '') })
    void queryClient.invalidateQueries({ queryKey: qk.agent(domainId ?? '') })
  }
  const focus = (chat: ChatInfo) => {
    // The server already made the new tab active; mirror that without a round trip.
    const current = queryClient.getQueryData<ChatList>(qk.chats(domainId ?? ''))
    if (current)
      setList({
        chats: [...current.chats.filter((entry) => entry.id !== chat.id), chat],
        activeId: chat.id,
      })
    refresh()
  }

  const open = useMutation({
    mutationFn: (harness?: string) => api.openChat(domainId!, harness),
    onSuccess: focus,
    onError: (error) => toast.error(`Could not open a chat — ${String(error)}`),
  })
  const select = useMutation({
    mutationFn: (chatId: string) => api.selectChat(domainId!, chatId),
    onSuccess: setList,
    onError: (error) => toast.error(String(error)),
  })
  const close = useMutation({
    mutationFn: (chatId: string) => api.closeChat(domainId!, chatId),
    onSuccess: (list) => {
      setList(list)
      refresh()
    },
    onError: (error) => toast.error(`Could not close the chat — ${String(error)}`),
  })
  const update = useMutation({
    mutationFn: (input: { chatId: string; title?: string; model?: string; effort?: string }) =>
      api.updateChat(domainId!, input.chatId, {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.effort === undefined ? {} : { effort: input.effort }),
      }),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(String(error)),
  })
  const switchHarness = useMutation({
    mutationFn: (input: { chatId: string; harness: string; model?: string }) =>
      api.switchChatHarness(domainId!, input.chatId, input.harness, input.model),
    onSuccess: (chat) => {
      focus(chat)
      toast.success('New chat — the previous conversation was summarized for it, and stays open')
    },
    onError: (error) => toast.error(`Could not switch agent — ${String(error)}`),
  })
  const forgetOrigin = useMutation({
    mutationFn: (chatId: string) => api.forgetChatOrigin(domainId!, chatId),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(`Could not delete the transferred context — ${String(error)}`),
  })

  return { open, select, close, update, switchHarness, forgetOrigin }
}

/**
 * Every harness's models, fetched only once the picker is open.
 *
 * Each entry is a live ACP probe of that harness, so this is not something to
 * pay for on every panel mount.
 */
export function useModelCatalog(domainId?: string, enabled = false) {
  return useQuery({
    queryKey: qk.models(domainId ?? ''),
    queryFn: () => api.models(domainId!),
    enabled: enabled && !!domainId,
    staleTime: 60_000,
  })
}
