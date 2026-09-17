import type { AgentRun } from '@shared/types'

import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

import { useChatList } from './chats'
import { useUI } from './store'

export interface AgentReceipt {
  key: string
  createdAt: string
  failed: boolean
  unread: boolean
}

interface AgentUnreadState {
  receipts: Record<string, AgentReceipt>
  completed: (run: AgentRun) => void
  read: (chatId: string, key: string) => void
}

function completionKey(run: AgentRun): string | undefined {
  if (run.status === 'running' || run.status === 'queued') return undefined
  if (run.status === 'canceled' && !run.events.some((event) => event.kind === 'message'))
    return undefined
  return `${run.id}:${run.status}`
}

/** Receipts contain no conversation text. Unread replies survive reloads and subsequent turns. */
export function createAgentUnreadStore(storage: StateStorage) {
  return create<AgentUnreadState>()(
    persist(
      (set) => ({
        receipts: {},
        completed: (run) => {
          const key = completionKey(run)
          if (!key) return
          set((state) => {
            const previous = state.receipts[run.chatId]
            // Replayed snapshots must neither resurrect a read reply nor replace a newer one.
            if (previous && (previous.key === key || previous.createdAt > run.createdAt))
              return state
            return {
              receipts: {
                ...state.receipts,
                [run.chatId]: {
                  key,
                  createdAt: run.createdAt,
                  failed: run.status === 'failed' || run.status === 'interrupted',
                  unread: true,
                },
              },
            }
          })
        },
        read: (chatId, key) =>
          set((state) => {
            const receipt = state.receipts[chatId]
            if (!receipt?.unread || receipt.key !== key) return state
            return { receipts: { ...state.receipts, [chatId]: { ...receipt, unread: false } } }
          }),
      }),
      {
        name: 'studio-agent-receipts',
        version: 1,
        storage: createJSONStorage(() => storage),
        partialize: ({ receipts }) => ({ receipts }),
      },
    ),
  )
}

// Storage can be denied by browser policy; notifications still work for the current visit.
const storage: StateStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* memory only */
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key)
    } catch {
      /* memory only */
    }
  },
}
export const useAgentUnread = createAgentUnreadStore(storage)

export function useUnreadAgentReplies() {
  const chats = useChatList()
  const receipts = useAgentUnread((state) => state.receipts)
  return useMemo(
    () =>
      chats.flatMap((chat) => {
        const receipt = receipts[chat.id]
        return receipt?.unread ? [{ chatId: chat.id, ...receipt }] : []
      }),
    [chats, receipts],
  )
}

/** A mounted transcript may be clipped by the closed dock or hidden in a background tab. */
export function useReadAgentReplies(chatId: string | undefined, turns: AgentRun[]) {
  const open = useUI((state) => state.panelOpen && state.panelTab === 'agent')
  const receipt = useAgentUnread((state) => (chatId ? state.receipts[chatId] : undefined))
  useEffect(() => {
    if (!open || !chatId || !receipt?.unread) return
    // Wait until this exact completed turn is actually available in the transcript.
    if (!turns.some((turn) => completionKey(turn) === receipt.key)) return
    const acknowledge = () => {
      if (document.visibilityState === 'visible')
        useAgentUnread.getState().read(chatId, receipt.key)
    }
    acknowledge()
    document.addEventListener('visibilitychange', acknowledge)
    return () => document.removeEventListener('visibilitychange', acknowledge)
  }, [chatId, open, receipt, turns])
}
