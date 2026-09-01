import { type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight, Globe, Plus } from 'lucide-react'
import { createContext, type ReactNode, useContext } from 'react'

import { cn } from '@/lib/utils'

import type { GroupNodeData } from '../projection'
import type { WorkspaceDomainNodeData } from './projection'

import { GroupNode, schemaNodeTypes } from '../graph'
import { SchemaIcon } from '../schema-icon'

export interface WorkspaceNodeActions {
  toggleModule: (domainId: string, path: string) => void
  /** Draw a domain this workspace holds, straight from the frame that stands for it. */
  addDomainToCanvas: (domainId: string) => void
  /** List an external frame's dependencies, or fold them back into a count. */
  toggleExternalExpanded: (origin: string) => void
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
 *
 * The boundary is carried by TWO things, because the canvas is read at every zoom: a
 * 2px dashed rule, which says "edge of a territory" up close, and a neutral wash over
 * the whole area, which is the only part that survives being zoomed out — a hairline
 * scaled to a third of a pixel does not. The wash is `foreground`, not a hue: it darkens
 * on the light canvas and lightens on the dark one, and leaves the module hues inside
 * as the only colour in the frame.
 */
function WorkspaceDomainNode({ data }: NodeProps) {
  const domain = data as WorkspaceDomainNodeData
  return (
    <div
      data-domain-id={domain.domainId}
      data-testid={`workspace-domain-${domain.domainId}`}
      className="relative h-full w-full rounded-xl border-2 border-dashed border-muted-foreground/35 bg-foreground/[0.04]"
    >
      {/* The origin sits ON the rule, painted over it in the canvas colour, so the frame
          reads as one labelled boundary rather than a box with a caption floating above. */}
      <span
        className="absolute -top-2.5 left-4 whitespace-nowrap px-2 text-[12px] font-semibold text-foreground/75"
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

interface WorkspaceExternalNodeData extends Record<string, unknown> {
  name: string
  origin: string
  kind: 'kernel' | 'external'
  icon?: string
  domainId?: string
  expanded: boolean
  connectedCount: number
  inertCount: number
}

/**
 * A domain the canvas depends on but does not draw.
 *
 * Two populations wear this same grey, and they do not answer to the same gesture: one is
 * a domain of THIS workspace, which the reader can simply put on the canvas — so the frame
 * says so and offers it — and the other is a domain they do not have, whose import is
 * someone else's to arrange. The second line counts what the frame is not showing: a full
 * dependency footprint is routinely a dozen classes, and folding them is what keeps this a
 * frame rather than a wall.
 */
function WorkspaceExtDomainNode({ data }: NodeProps) {
  const actions = useWorkspaceNodeActions()
  const external = data as WorkspaceExternalNodeData
  const foldable = external.inertCount > 0
  // Present only when this origin is a domain the workspace already has.
  const promotable = external.domainId
  return (
    <div className="h-full w-full rounded-lg border border-dashed bg-muted/40">
      <div className="flex h-[42px] flex-col justify-center gap-0.5 px-2.5 text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0">
            {external.icon ? (
              <SchemaIcon svg={external.icon} className="h-4 w-4" />
            ) : (
              <Globe className="h-4 w-4" />
            )}
          </span>
          <span className="truncate text-[12px] font-semibold text-foreground/80">
            {external.name}
          </span>
          {promotable !== undefined && (
            <button
              type="button"
              className="nodrag ml-auto grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              title={`Draw ${external.origin} on the canvas`}
              aria-label={`Add ${external.origin} to the canvas`}
              onClick={(event) => {
                event.stopPropagation()
                actions.addDomainToCanvas(promotable)
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={!foldable}
          title={
            foldable
              ? external.expanded
                ? 'Fold the dependencies nothing points at'
                : 'List the dependencies nothing points at'
              : undefined
          }
          onClick={(event) => {
            event.stopPropagation()
            actions.toggleExternalExpanded(external.origin)
          }}
          className={cn(
            'nodrag flex items-center gap-1 text-[10px] uppercase tracking-wider',
            foldable && 'transition-colors hover:text-foreground',
          )}
        >
          {foldable &&
            (external.expanded ? (
              <ChevronDown className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" />
            ))}
          <span className="truncate">
            {external.kind}
            {foldable ? ` · ${external.inertCount} more` : ''}
          </span>
        </button>
      </div>
    </div>
  )
}

export const workspaceNodeTypes = {
  ...schemaNodeTypes,
  group: WorkspaceGroupNode,
  moduleNode: WorkspaceGroupNode,
  workspaceDomain: WorkspaceDomainNode,
  extDomain: WorkspaceExtDomainNode,
}
