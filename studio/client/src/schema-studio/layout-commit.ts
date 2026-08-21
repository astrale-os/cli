import type { LayoutState } from '@shared/types'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

import { api, qk } from '@/lib/api'

import type { Geometry } from './geometry'

export function useLayoutCommitter(): {
  commitLayout: (domainId: string, updates: Geometry) => void
  flushLayout: (domainId: string) => void
} {
  const queryClient = useQueryClient()
  const dirty = useRef(new Map<string, Geometry>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const flushLayout = useCallback((domainId: string) => {
    const timer = timers.current.get(domainId)
    if (timer) clearTimeout(timer)
    timers.current.delete(domainId)
    const updates = dirty.current.get(domainId)
    dirty.current.delete(domainId)
    if (updates && Object.keys(updates).length > 0) {
      void api.setLayout(domainId, updates).catch(() => {})
    }
  }, [])

  const commitLayout = useCallback(
    (domainId: string, updates: Geometry) => {
      queryClient.setQueryData<LayoutState>(qk.layout(domainId), (current) => ({
        renderFingerprint: current?.renderFingerprint,
        positions: { ...current?.positions, ...updates },
      }))
      dirty.current.set(domainId, { ...dirty.current.get(domainId), ...updates })
      const timer = timers.current.get(domainId)
      if (timer) clearTimeout(timer)
      timers.current.set(
        domainId,
        setTimeout(() => flushLayout(domainId), 500),
      )
    },
    [flushLayout, queryClient],
  )

  useEffect(
    () => () => {
      for (const domainId of dirty.current.keys()) flushLayout(domainId)
    },
    [flushLayout],
  )

  return { commitLayout, flushLayout }
}
