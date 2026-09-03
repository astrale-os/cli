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
 * Never a domain prepared for a different selection: a same-sized workspace of different
 * domains would otherwise draw the previous canvas under the new one's name. Domains shared by
 * both selections are already valid, though, so keep that intersection on screen while the new
 * composition is prepared. This is what makes an eye toggle change the canvas without blanking
 * the whole schema section.
 *
 * A re-projection of the SAME selection is a different matter — a drag persisted, a class
 * hidden, a module collapsed all rebuild the projection, and until the new one lands the
 * canvas keeps the one it has. Blanking there swaps the canvas for a placeholder, which
 * UNMOUNTS React Flow: what comes back has a fresh store with no viewport and re-frames
 * itself, which is how a drop threw away the pan and zoom the reader had set.
 */
export function preparedWorkspaceStatus(
  expectedDomainIds: string[],
  state: PreparedWorkspaceState,
): { domains: WorkspaceDomainProjection[]; ready: boolean } {
  const expectedSelection = expectedDomainIds.join('::')
  const matches = state.selection !== null && state.selection === expectedSelection
  if (matches) {
    return {
      // Keep the exact array identity: the graph uses it to recognize layout-write echoes.
      domains: state.domains,
      ready: state.domains.length === expectedDomainIds.length,
    }
  }

  const preparedById = new Map(
    state.domains.map((domain) => [domain.input.summary.id, domain] as const),
  )
  const domains = expectedDomainIds.flatMap((id) => {
    const domain = preparedById.get(id)
    return domain ? [domain] : []
  })

  return {
    domains,
    ready: state.selection !== null && domains.length === expectedDomainIds.length,
  }
}

/**
 * How many domain projections are kept beyond the ones on the canvas.
 *
 * Taking a domain off the canvas used to be two gestures — one that dropped it and one
 * that only stopped drawing it — and the second one existed because dropping it threw the
 * projection away, so putting it back paid for a fresh ELK layout. There is one gesture
 * now, and this is what pays for it: an unchecked domain's projection survives, so
 * checking it again repaints instead of re-laying out.
 */
export const PROJECTION_CACHE_SIZE = 12

/** Least-recently-used eviction, with everything currently on the canvas held back. */
export function evictStaleProjections<T>(
  cache: Map<string, T>,
  keep: string[],
  max = PROJECTION_CACHE_SIZE,
): void {
  // A Map iterates in insertion order, so re-setting the live ids makes them the newest.
  for (const id of keep) {
    if (!cache.has(id)) continue
    const entry = cache.get(id)!
    cache.delete(id)
    cache.set(id, entry)
  }
  const held = new Set(keep)
  for (const id of [...cache.keys()]) {
    if (cache.size <= max) break
    if (held.has(id)) continue
    cache.delete(id)
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
      if (cancelled) return
      evictStaleProjections(
        cache.current,
        inputs.map((input) => input.summary.id),
      )
      setState({ selection: workspaceSelectionKey(inputs), domains })
    })
    return () => {
      cancelled = true
    }
    // `preparationKey` is the compact semantic snapshot consumed by this run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparationKey])

  return preparedWorkspaceStatus(
    inputs.map((input) => input.summary.id),
    state,
  )
}
