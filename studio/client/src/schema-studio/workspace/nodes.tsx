import { NodeResizeControl, type NodeProps } from '@xyflow/react'
import { createContext, type ReactNode, useContext } from 'react'

import { cn } from '@/lib/utils'

import type { GroupNodeData } from '../projection'
import type { WorkspaceDomainNodeData } from './projection'

import { GroupNode, schemaNodeTypes } from '../graph'
import { DOMAIN_MIN_SIZE, MODULE_MIN_SIZE, type WorkspaceSize, workspaceGeometry } from './geometry'

export interface WorkspaceNodeActions {
  activateDomain: (domainId: string) => void
  resizeNode: (nodeId: string, size: WorkspaceSize) => void
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

function ResizeCorner({
  nodeId,
  minimum,
  label,
  placement = 'module',
}: {
  nodeId: string
  minimum: WorkspaceSize
  label: string
  placement?: 'domain' | 'module'
}) {
  const actions = useWorkspaceNodeActions()
  return (
    <NodeResizeControl
      position="bottom-right"
      minWidth={minimum.width}
      minHeight={minimum.height}
      onResizeEnd={(_, size) =>
        actions.resizeNode(nodeId, {
          width: Math.round(size.width),
          height: Math.round(size.height),
        })
      }
      // sits ON the frame's bottom-right corner (it used to float in empty space,
      // reading as a stray artifact) and only appears while the frame is hovered
      style={{ left: 'calc(100% - 16px)', top: 'calc(100% - 16px)' }}
      className="nodrag nopan !flex !h-4 !w-4 !cursor-se-resize !items-end !justify-end !border-0 !bg-transparent !p-0 opacity-0 transition-opacity group-hover/frame:opacity-100"
    >
      <span
        data-testid={`workspace-resize-${nodeId}`}
        title={label}
        className="block h-2.5 w-2.5 rounded-br-[3px] border-b-2 border-r-2 border-muted-foreground transition-colors hover:border-primary"
      />
    </NodeResizeControl>
  )
}

function WorkspaceDomainNode({ id, data }: NodeProps) {
  const actions = useWorkspaceNodeActions()
  const domain = data as WorkspaceDomainNodeData
  return (
    <div
      data-domain-id={domain.domainId}
      title={domain.active ? undefined : `Click to activate ${domain.origin}`}
      className={cn(
        'group/frame relative h-full w-full rounded-xl border bg-card transition-colors',
        domain.active
          ? 'border-primary/45 bg-primary/[0.03]'
          : 'cursor-pointer border-border hover:border-muted-foreground/40',
      )}
    >
      <div
        data-testid={`workspace-domain-header-${domain.domainId}`}
        title={`Drag ${domain.origin}`}
        onPointerDownCapture={() => actions.activateDomain(domain.domainId)}
        className="workspace-domain-drag-handle absolute inset-x-0 top-0 flex h-12 cursor-grab select-none items-center gap-2 px-4 active:cursor-grabbing"
      >
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            domain.active ? 'bg-primary' : 'bg-muted-foreground/40',
          )}
        />
        <span className="truncate text-[13px] font-semibold tracking-tight">{domain.origin}</span>
      </div>
      {domain.active && (
        <ResizeCorner
          nodeId={id}
          minimum={DOMAIN_MIN_SIZE}
          label={`Resize ${domain.origin}`}
          placement="domain"
        />
      )}
    </div>
  )
}

function WorkspaceGroupNode(props: NodeProps) {
  const actions = useWorkspaceNodeActions()
  const metadata = workspaceGeometry(props)
  const data = props.data as GroupNodeData
  return (
    <div className="group/frame relative h-full w-full">
      <GroupNode
        {...props}
        data={{
          ...data,
          onToggleModule: actions.toggleModule,
        }}
      />
      {props.type === 'group' && metadata?.active && (
        <ResizeCorner nodeId={props.id} minimum={MODULE_MIN_SIZE} label="Resize module" />
      )}
    </div>
  )
}

export const workspaceNodeTypes = {
  ...schemaNodeTypes,
  group: WorkspaceGroupNode,
  moduleNode: WorkspaceGroupNode,
  workspaceDomain: WorkspaceDomainNode,
}
