import type { WorkspaceUiState } from '@shared/contracts/workspace'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { api, qk, unreadableOf } from './api'
import { sayOnScreen } from './notices'
import { hydrateWorkspaceUi, uiWorkspaceSnapshot, useUI } from './store'

/** `readerDomainId`: null forgets the last Domain read, none keeps it. */
type WorkspaceUiUpdate = Omit<WorkspaceUiState, 'readerDomainId'> & {
  readerDomainId?: string | null
}

function snapshot(): WorkspaceUiUpdate {
  return { version: 1, ...uiWorkspaceSnapshot() }
}

/**
 * Hydrate the UI store from the workspace's machine-side file, then keep its persistent
 * projection in that file. A brief debounce coalesces a panel resize without delaying ordinary
 * navigation noticeably.
 */
export function useWorkspaceUiSync(): boolean {
  const query = useQuery({
    queryKey: qk.workspaceState,
    queryFn: api.workspaceState,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const hydrated = useRef(false)

  // a file not read whole: the Studio opens on its defaults, saves nothing over it, and says so
  const unreadable = unreadableOf(query.error)?.sentence
  useEffect(() => {
    if (unreadable) sayOnScreen(unreadable)
  }, [unreadable])

  useEffect(() => {
    if (!query.data || hydrated.current) return
    hydrateWorkspaceUi(query.data)
    hydrated.current = true
  }, [query.data])

  useEffect(() => {
    if (!query.data) return
    let last = JSON.stringify(snapshot())
    let pending: WorkspaceUiUpdate | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const flush = () => {
      timer = undefined
      if (!pending) return
      const next = pending
      pending = undefined
      void api.updateWorkspaceState(next).catch((error: unknown) => {
        console.error('Could not persist workspace UI state', error)
      })
    }
    const changed = () => {
      const next = snapshot()
      const serialized = JSON.stringify(next)
      if (serialized === last) return
      last = serialized
      pending = next
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 120)
    }

    const stop = useUI.subscribe(changed)
    return () => {
      stop()
      if (timer) clearTimeout(timer)
      flush()
    }
  }, [query.data])

  return query.data !== undefined || query.isError
}
