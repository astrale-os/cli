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
      style={
        placement === 'domain'
          ? { left: 'calc(100% - 6px)', top: 'calc(100% + 20px)' }
          : { left: 'calc(100% + 20px)', top: 'calc(100% + 20px)' }
      }
      className="nodrag nopan !flex !h-6 !w-6 !cursor-se-resize !items-start !justify-start !border-0 !bg-transparent !p-0"
    >
      <span
        data-testid={`workspace-resize-${nodeId}`}
        title={label}
        className="block h-3 w-3 rounded-br-[3px] border-b-2 border-r-2 border-sky-300/60 opacity-45 transition-[opacity,border-color] hover:border-sky-200 hover:opacity-100 active:border-sky-100 active:opacity-100"
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
        'relative h-full w-full rounded-[22px] border-2 bg-card/[0.035] shadow-[0_24px_80px_-48px_rgba(0,0,0,0.9)] transition-colors',
        domain.active
          ? 'border-sky-400/55 bg-sky-400/[0.045]'
          : 'cursor-pointer border-border/55 hover:border-border',
      )}
    >
      <div
        data-testid={`workspace-domain-header-${domain.domainId}`}
        title={`Drag ${domain.origin}`}
        onPointerDownCapture={() => actions.activateDomain(domain.domainId)}
        className="workspace-domain-drag-handle absolute inset-x-0 top-0 flex h-12 cursor-grab select-none items-center gap-2 border-b border-border/35 px-4 active:cursor-grabbing"
      >
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            domain.active
              ? 'bg-sky-300 shadow-[0_0_12px_rgba(125,211,252,0.8)]'
              : 'bg-muted-foreground/35',
          )}
        />
        <span className="truncate text-[13px] font-extrabold tracking-tight">{domain.origin}</span>
        <span className="ml-auto rounded-full bg-muted/70 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-muted-foreground">
          {domain.memberCount}
        </span>
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
    <div className="relative h-full w-full">
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
