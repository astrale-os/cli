import type { WorkspaceUiState } from '@shared/types'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import {
  hydrateSchemaWorkspace,
  schemaWorkspaceSnapshot,
  useSchemaWorkspace,
} from '@/schema-studio/workspace/store'

import { api, qk } from './api'
import { hydrateWorkspaceUi, uiWorkspaceSnapshot, useUI } from './store'

type WorkspaceUiUpdate = Omit<WorkspaceUiState, 'readerDomainId'> & {
  readerDomainId: string | null
}

function snapshot(): WorkspaceUiUpdate {
  return {
    version: 1,
    ...uiWorkspaceSnapshot(),
    schema: schemaWorkspaceSnapshot(),
  }
}

/**
 * Hydrate both UI stores from the workspace's machine-side file, then keep their
 * persistent projections together in that one file. A brief debounce coalesces a
 * panel resize without delaying ordinary navigation noticeably.
 */
export function useWorkspaceUiSync(): boolean {
  const query = useQuery({
    queryKey: qk.workspaceState,
    queryFn: api.workspaceState,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const hydrated = useRef(false)

  useEffect(() => {
    if (!query.data || hydrated.current) return
    hydrateWorkspaceUi(query.data)
    hydrateSchemaWorkspace(query.data.schema)
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

    const stopUi = useUI.subscribe(changed)
    const stopSchema = useSchemaWorkspace.subscribe(changed)
    return () => {
      stopUi()
      stopSchema()
      if (timer) clearTimeout(timer)
      flush()
    }
  }, [query.data])

  return query.data !== undefined || query.isError
}
