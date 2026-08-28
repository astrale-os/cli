import { useEffect, useMemo, useRef, useState } from 'react'

import { buildViewsModel } from '@/lib/views'

import type { WorkspaceDomainInput } from './use-domain-inputs'

import { viewGraphKey } from '../view-graph'
import { prepareWorkspaceDomain, type WorkspaceDomainProjection } from './projection'

export function domainPreparationKey(
  input: WorkspaceDomainInput,
  collapsedModules: string[],
): string {
  return [
    input.summary.id,
    input.summary.origin,
    input.bundle.renderFingerprint,
    // Views come from anatomy, which the render fingerprint does not cover.
    viewGraphKey(buildViewsModel(input.anatomy, input.bundle)),
    Object.keys(input.visibility.hidden).sort().join(','),
    input.visibility.showInheritedEdges,
    Object.entries(input.layout.positions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([id, position]) =>
          `${id}:${position.x}:${position.y}:${position.w ?? ''}:${position.h ?? ''}`,
      )
      .join(','),
    collapsedModules.slice().sort().join(','),
  ].join('|')
}

export interface PreparedWorkspaceState {
  key: string | null
  domains: WorkspaceDomainProjection[]
}

/** Never expose projections prepared for another, even same-sized, workspace selection. */
export function preparedWorkspaceStatus(
  expectedKey: string,
  expectedCount: number,
  state: PreparedWorkspaceState,
): { domains: WorkspaceDomainProjection[]; ready: boolean } {
  const current = state.key === expectedKey ? state.domains : []
  return { domains: current, ready: state.key === expectedKey && current.length === expectedCount }
}

export function usePreparedWorkspaceDomains(
  inputs: WorkspaceDomainInput[],
  collapsedModules: Record<string, string[]>,
): { domains: WorkspaceDomainProjection[]; ready: boolean } {
  const [state, setState] = useState<PreparedWorkspaceState>({ key: null, domains: [] })
  const cache = useRef(new Map<string, { key: string; projection: WorkspaceDomainProjection }>())
  const preparationKey = useMemo(
    () =>
      inputs
        .map((input) => domainPreparationKey(input, collapsedModules[input.summary.id] ?? []))
        .join('::'),
    [collapsedModules, inputs],
  )

  useEffect(() => {
    let cancelled = false
    const selected = new Set(inputs.map((input) => input.summary.id))
    for (const domainId of cache.current.keys()) {
      if (!selected.has(domainId)) cache.current.delete(domainId)
    }
    Promise.all(
      inputs.map(async (input) => {
        const domainId = input.summary.id
        const collapsed = collapsedModules[domainId] ?? []
        const key = domainPreparationKey(input, collapsed)
        const cached = cache.current.get(domainId)
        if (cached?.key === key) return { ...cached.projection, input }
        const projection = await prepareWorkspaceDomain(input, collapsed)
        if (!cancelled) cache.current.set(domainId, { key, projection })
        return projection
      }),
    ).then((domains) => {
      if (!cancelled) setState({ key: preparationKey, domains })
    })
    return () => {
      cancelled = true
    }
    // `preparationKey` is the compact semantic snapshot consumed by this run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparationKey])

  return preparedWorkspaceStatus(preparationKey, inputs.length, state)
}
