import type { LayoutState } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

import { api, qk } from '@/lib/api'

import type { Geometry } from './geometry'

export function useLayoutCommitter(): {
  commitLayout: (domainId: string, updates: Geometry) => void
  flushLayout: (domainId: string) => void
  discardLayout: (domainId: string) => void
} {
  const queryClient = useQueryClient()
  const dirty = useRef(new Map<string, Geometry>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const cancelTimer = useCallback((domainId: string) => {
    const timer = timers.current.get(domainId)
    if (timer) clearTimeout(timer)
    timers.current.delete(domainId)
  }, [])

  const flushLayout = useCallback(
    (domainId: string) => {
      cancelTimer(domainId)
      const updates = dirty.current.get(domainId)
      dirty.current.delete(domainId)
      if (updates && Object.keys(updates).length > 0) {
        void api.setLayout(domainId, updates).catch(() => {})
      }
    },
    [cancelTimer],
  )

  // Drop a debounced write instead of sending it. Auto-arrange erases the record on disk,
  // and a drag from the half-second before it would otherwise land AFTER that erase — the
  // very positions the reader asked to discard, written straight back.
  const discardLayout = useCallback(
    (domainId: string) => {
      cancelTimer(domainId)
      dirty.current.delete(domainId)
    },
    [cancelTimer],
  )

  const commitLayout = useCallback(
    (domainId: string, updates: Geometry) => {
      queryClient.setQueryData<LayoutState>(qk.layout(domainId), (current) => ({
        renderFingerprint: current?.renderFingerprint,
        positions: { ...current?.positions, ...updates },
      }))
      dirty.current.set(domainId, { ...dirty.current.get(domainId), ...updates })
      cancelTimer(domainId)
      timers.current.set(
        domainId,
        setTimeout(() => flushLayout(domainId), 500),
      )
    },
    [cancelTimer, flushLayout, queryClient],
  )

  useEffect(
    () => () => {
      for (const domainId of dirty.current.keys()) flushLayout(domainId)
    },
    [flushLayout],
  )

  return { commitLayout, flushLayout, discardLayout }
}
