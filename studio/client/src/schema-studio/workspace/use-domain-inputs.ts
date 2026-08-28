import type {
  DomainAnatomy,
  DomainSummary,
  LayoutState,
  StudioSchemaBundle,
  VisibilityState,
} from '@shared/types'

import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  anatomyQueryOptions,
  bundleQueryOptions,
  layoutQueryOptions,
  visibilityQueryOptions,
} from '@/lib/domain-queries'

export interface WorkspaceDomainInput {
  summary: DomainSummary
  bundle: StudioSchemaBundle
  anatomy: DomainAnatomy
  layout: LayoutState
  visibility: VisibilityState
}

const EMPTY_LAYOUT: LayoutState = { positions: {} }
const EMPTY_VISIBILITY: VisibilityState = {
  hidden: {},
  showInheritedEdges: true,
}

export function useWorkspaceDomainInputs(
  ids: string[],
  domains: DomainSummary[] | undefined,
): { inputs: WorkspaceDomainInput[]; pending: boolean; errors: string[] } {
  const bundles = useQueries({
    queries: ids.map(bundleQueryOptions),
  })
  const anatomies = useQueries({
    queries: ids.map(anatomyQueryOptions),
  })
  const layouts = useQueries({
    queries: ids.map(layoutQueryOptions),
  })
  const visibilities = useQueries({
    queries: ids.map(visibilityQueryOptions),
  })

  return useMemo(() => {
    const byId = new Map((domains ?? []).map((domain) => [domain.id, domain]))
    const inputs: WorkspaceDomainInput[] = []
    const errors: string[] = []
    let pending = false

    ids.forEach((id, index) => {
      const summary = byId.get(id)
      const bundle = bundles[index]?.data
      const anatomy = anatomies[index]?.data
      const error = bundles[index]?.error ?? anatomies[index]?.error
      if (error) errors.push(`${summary?.origin ?? id}: ${String(error)}`)
      if (!summary || !bundle || !anatomy) {
        pending = pending || !error
        return
      }
      inputs.push({
        summary,
        bundle,
        anatomy,
        layout: layouts[index]?.data ?? EMPTY_LAYOUT,
        visibility: visibilities[index]?.data ?? EMPTY_VISIBILITY,
      })
    })

    return { inputs, pending, errors }
  }, [anatomies, bundles, domains, ids, layouts, visibilities])
}
