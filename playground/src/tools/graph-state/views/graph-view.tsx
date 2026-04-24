import {
  ReactFlow,
  Background,
  useNodesState,
  useEdgesState,
  type NodeMouseHandler,
  type Node,
  type Edge,
} from '@xyflow/react'
import { Layers, Crosshair } from 'lucide-react'
import { useState, useMemo, useCallback, useEffect } from 'react'

import { useWorkspace } from '@/hooks/use-workspace'
import { BusinessEdgeComponent } from '@/tools/graph-state/components/business-edge'
import { BusinessNodeComponent } from '@/tools/graph-state/components/business-node'
import { GraphLegend } from '@/tools/graph-state/components/graph-legend'
import { businessToFlow } from '@/tools/graph-state/lib/business-to-flow'
import { DEFAULT_HIDDEN_CLASSES } from '@/tools/graph-state/lib/kernel-fabric'
import { rawToBusiness } from '@/tools/graph-state/lib/raw-to-business'

const nodeTypes = { businessNode: BusinessNodeComponent }
const edgeTypes = { businessEdge: BusinessEdgeComponent }

export function GraphView() {
  const workspace = useWorkspace()
  const [hiddenClasses, setHiddenClasses] = useState<Set<string>>(
    () => new Set(DEFAULT_HIDDEN_CLASSES),
  )
  const [hiddenDomains, setHiddenDomains] = useState<Set<string>>(() => new Set(['kernel']))

  const toggleClass = useCallback((className: string) => {
    setHiddenClasses((prev) => {
      const next = new Set(prev)
      if (next.has(className)) next.delete(className)
      else next.add(className)
      return next
    })
  }, [])

  const unfilteredGraph = useMemo(
    () => (workspace.graphState ? rawToBusiness(workspace.graphState) : null),
    [workspace.graphState],
  )

  const businessGraph = useMemo(
    () =>
      workspace.graphState
        ? rawToBusiness(workspace.graphState, { hiddenClasses, hiddenDomains })
        : null,
    [workspace.graphState, hiddenClasses, hiddenDomains],
  )

  const flowResult = useMemo(
    () => (businessGraph ? businessToFlow(businessGraph, 'LR') : null),
    [businessGraph],
  )

  // Controlled nodes & edges state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // Sync computed flow data into controlled state
  useEffect(() => {
    setNodes(flowResult?.nodes ?? [])
    setEdges(flowResult?.edges ?? [])
  }, [flowResult, setNodes, setEdges])

  const onNodeClick: NodeMouseHandler = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      const nodeId = node.id.replace('bn:', '')
      if (workspace.nodePicker) {
        workspace.nodePicker.resolve(nodeId)
        workspace.cancelNodePicker()
        return
      }
      workspace.setSelection({ type: 'graph-node', id: nodeId })
    },
    [workspace],
  )

  const onEdgeClick = useCallback(
    (_e: React.MouseEvent, edge: { id: string }) => {
      workspace.setSelection({ type: 'graph-edge', id: edge.id.replace('be:', '') })
    },
    [workspace],
  )

  const onPaneClick = useCallback(() => {
    if (workspace.nodePicker) workspace.cancelNodePicker()
    workspace.setSelection(null)
    setNodes((nds) => nds.map((n) => ({ ...n, selected: false })))
    setEdges((eds) => eds.map((e) => ({ ...e, selected: false })))
  }, [workspace, setNodes, setEdges])

  if (!workspace.graphState) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center space-y-3">
          <Layers className="h-12 w-12 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Load the graph to visualize it</p>
          <button
            onClick={workspace.refreshGraphState}
            disabled={workspace.graphStateLoading}
            className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {workspace.graphStateLoading ? 'Loading...' : 'Load Graph'}
          </button>
          {workspace.graphStateError && (
            <p className="text-xs text-destructive">{workspace.graphStateError}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {unfilteredGraph && (
        <GraphLegend
          nodeClasses={unfilteredGraph.nodeClasses}
          edgeClasses={unfilteredGraph.edgeClasses}
          hiddenClasses={hiddenClasses}
          onToggleClass={toggleClass}
          onSetHiddenClasses={setHiddenClasses}
          hiddenDomains={hiddenDomains}
          onSetHiddenDomains={setHiddenDomains}
          onRefresh={workspace.refreshGraphState}
          refreshLoading={workspace.graphStateLoading}
        />
      )}

      {workspace.nodePicker && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-md border-2 border-primary bg-primary text-primary-foreground shadow-lg px-4 h-9">
          <Crosshair className="h-4 w-4 animate-pulse" />
          <span className="text-sm font-semibold">
            Pick a node for "{workspace.nodePicker.fieldKey}"
          </span>
          <button
            onClick={workspace.cancelNodePicker}
            className="text-primary-foreground/70 hover:text-primary-foreground ml-1 text-xs underline"
          >
            Cancel
          </button>
        </div>
      )}

      <ReactFlow
        style={
          {
            '--xy-node-boxshadow-selected-default': 'none',
            '--xy-node-border-radius-default': '6px',
          } as React.CSSProperties
        }
        className={workspace.nodePicker ? 'cursor-crosshair' : ''}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.05}
        maxZoom={2}
      >
        <Background />
      </ReactFlow>
    </>
  )
}
