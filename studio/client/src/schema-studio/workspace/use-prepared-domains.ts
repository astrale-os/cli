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

/** The domains a prepared projection belongs to — its identity, whatever it was prepared from. */
export function workspaceSelectionKey(inputs: WorkspaceDomainInput[]): string {
  return inputs.map((input) => input.summary.id).join('::')
}

export interface PreparedWorkspaceState {
  selection: string | null
  domains: WorkspaceDomainProjection[]
}

/**
 * Which projections this render may draw.
 *
 * Never the ones prepared for another SELECTION: a same-sized workspace of different domains
 * would draw the previous one's canvas under the new one's name.
 *
 * A re-projection of the SAME selection is a different matter — a drag persisted, a class
 * hidden, a module collapsed all rebuild the projection, and until the new one lands the
 * canvas keeps the one it has. Blanking there swaps the canvas for a placeholder, which
 * UNMOUNTS React Flow: what comes back has a fresh store with no viewport and re-frames
 * itself, which is how a drop threw away the pan and zoom the reader had set.
 */
export function preparedWorkspaceStatus(
  expectedSelection: string,
  expectedCount: number,
  state: PreparedWorkspaceState,
): { domains: WorkspaceDomainProjection[]; ready: boolean } {
  const matches = state.selection !== null && state.selection === expectedSelection
  return {
    domains: matches ? state.domains : [],
    ready: matches && state.domains.length === expectedCount,
  }
}

export function usePreparedWorkspaceDomains(
  inputs: WorkspaceDomainInput[],
  collapsedModules: Record<string, string[]>,
): { domains: WorkspaceDomainProjection[]; ready: boolean } {
  const [state, setState] = useState<PreparedWorkspaceState>({ selection: null, domains: [] })
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
      if (!cancelled) setState({ selection: workspaceSelectionKey(inputs), domains })
    })
    return () => {
      cancelled = true
    }
    // `preparationKey` is the compact semantic snapshot consumed by this run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparationKey])

  return preparedWorkspaceStatus(workspaceSelectionKey(inputs), inputs.length, state)
}
