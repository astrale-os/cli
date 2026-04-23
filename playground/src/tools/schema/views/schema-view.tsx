import {
  ReactFlow,
  Background,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type Node,
  type Edge,
} from '@xyflow/react'
import { Network } from 'lucide-react'
import { useMemo, useCallback } from 'react'

import { useWorkspace } from '@/hooks/use-workspace'
import { SchemaEdgeComponent } from '@/tools/schema/components/schema-edge-component'
import { SchemaNodeComponent } from '@/tools/schema/components/schema-node-component'
import { schemaToFlow } from '@/tools/schema/lib/schema-to-flow'

const nodeTypes = { schemaNode: SchemaNodeComponent }
const edgeTypes = { schemaEdge: SchemaEdgeComponent }

export function SchemaView() {
  const workspace = useWorkspace()
  const schema = workspace.schema
  const selection = workspace.selection

  const { nodes, edges } = useMemo(
    () => (schema ? schemaToFlow(schema, 'LR') : { nodes: [], edges: [] }),
    [schema],
  )

  const styledNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: selection?.type === 'schema-node' && `node:${selection.id}` === n.id,
      })),
    [nodes, selection],
  )

  const styledEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        selected: selection?.type === 'schema-edge' && e.id.startsWith(`edge:${selection.id}:`),
      })),
    [edges, selection],
  )

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      workspace.setSelection({ type: 'schema-node', id: node.id.replace('node:', '') })
    },
    [workspace],
  )

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      workspace.setSelection({ type: 'schema-edge', id: edge.id.split(':')[1] })
    },
    [workspace],
  )

  const onPaneClick = useCallback(() => workspace.setSelection(null), [workspace])

  if (!schema) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center space-y-3">
          <Network className="h-12 w-12 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Load a schema in the Schema tab to visualize it
          </p>
          <p className="text-xs text-muted-foreground/60">Press &#8984;1 to open the Schema tab</p>
        </div>
      </div>
    )
  }

  return (
    <ReactFlow
      nodes={styledNodes}
      edges={styledEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2}
    >
      <Background />
    </ReactFlow>
  )
}
