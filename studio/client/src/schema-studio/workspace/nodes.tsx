import { type NodeProps } from '@xyflow/react'
import { createContext, type ReactNode, useContext } from 'react'

import type { GroupNodeData } from '../projection'
import type { WorkspaceDomainNodeData } from './projection'

import { GroupNode, schemaNodeTypes } from '../graph'

export interface WorkspaceNodeActions {
  toggleModule: (domainId: string, path: string) => void
}

const WorkspaceNodeActionsContext = createContext<WorkspaceNodeActions | null>(null)

export function WorkspaceNodeActionsProvider({
  actions,
  children,
}: {
  actions: WorkspaceNodeActions
  children: ReactNode
}) {
  return (
    <WorkspaceNodeActionsContext.Provider value={actions}>
      {children}
    </WorkspaceNodeActionsContext.Provider>
  )
}

function useWorkspaceNodeActions(): WorkspaceNodeActions {
  const actions = useContext(WorkspaceNodeActionsContext)
  if (!actions) throw new Error('Workspace nodes require WorkspaceNodeActionsProvider')
  return actions
}

/**
 * The boundary of one domain: a dashed rectangle with the origin on its shoulder.
 *
 * It behaves like a module box — it wraps exactly what it holds, and you move it by
 * grabbing it anywhere. It is deliberately INERT to selection: clicking a class inside
 * makes its domain the active one, but the frame does not repaint to say so. Which
 * domain is active is answered once, in the modules rail, instead of every boundary on
 * the canvas changing colour whenever a selection moves.
 */
function WorkspaceDomainNode({ data }: NodeProps) {
  const domain = data as WorkspaceDomainNodeData
  return (
    <div
      data-domain-id={domain.domainId}
      data-testid={`workspace-domain-${domain.domainId}`}
      title={`Drag ${domain.origin}`}
      className="relative h-full w-full cursor-grab rounded-xl border border-dashed border-border active:cursor-grabbing"
    >
      <span
        className="absolute -top-2 left-4 whitespace-nowrap px-2 text-[11px] font-medium text-muted-foreground"
        style={{ background: 'var(--color-canvas)' }}
      >
        {domain.origin}
      </span>
    </div>
  )
}

/** A module box that knows which domain it belongs to, so collapsing it activates that domain. */
function WorkspaceGroupNode(props: NodeProps) {
  const actions = useWorkspaceNodeActions()
  const data = props.data as GroupNodeData
  return <GroupNode {...props} data={{ ...data, onToggleModule: actions.toggleModule }} />
}

export const workspaceNodeTypes = {
  ...schemaNodeTypes,
  group: WorkspaceGroupNode,
  moduleNode: WorkspaceGroupNode,
  workspaceDomain: WorkspaceDomainNode,
}
