import { useMemo } from 'react'

import { useWorkspace } from '@/hooks/use-workspace'
import { BusinessEdgeDetail } from '@/tools/graph-state/components/business-edge-detail'
import { BusinessNodeDetail } from '@/tools/graph-state/components/business-node-detail'
import { rawToBusiness } from '@/tools/graph-state/lib/raw-to-business'

export function GraphInspector() {
  const { graphState, selection } = useWorkspace()

  const businessGraph = useMemo(() => (graphState ? rawToBusiness(graphState) : null), [graphState])

  if (!businessGraph) return null

  if (selection?.type === 'graph-node')
    return <BusinessNodeDetail graph={businessGraph} nodeId={selection.id} />
  if (selection?.type === 'graph-edge')
    return <BusinessEdgeDetail graph={businessGraph} edgeId={selection.id} />
  return null
}
