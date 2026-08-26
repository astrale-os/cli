import type { AnchorRef, Comment } from '@shared/types'

import { Handle, type NodeProps, Position } from '@xyflow/react'
import { Box, ChevronDown, ChevronRight, Globe, MessageSquare, UserRound } from 'lucide-react'
import { useState } from 'react'

import { hasUnsentDraft } from '@/components/thread'
import { ThreadPopover } from '@/components/thread-popover'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import type { CanvasCommentNodeData } from './structure'

import { NodeCommentPin } from '../node-comment-pin'
import { CLASS_H, CLASS_W, moduleTint } from '../palette'
import { type ClassNodeData, type GroupNodeData } from '../projection'
import { SchemaIcon } from '../schema-icon'

// ── custom nodes ──

function ClassNode({ data }: NodeProps) {
  const d = data as ClassNodeData
  const selected = useUI((s) => s.domainId === d.domainId && s.selectedClass === `class.${d.name}`)
  const tint = moduleTint(d.hue)
  return (
    <div
      data-domain-id={d.domainId}
      data-core-role={d.coreRole ?? undefined}
      // the module colour is a left border, not an inset bar: the card can't clip
      // its own comment pin (which sits on the corner) with `overflow-hidden`.
      style={{ width: CLASS_W, height: CLASS_H, borderLeft: `3px solid ${tint.mark}` }}
      className={cn(
        'relative flex items-center gap-2 rounded-md border bg-card pl-2.5 pr-2 transition-[border-color,box-shadow]',
        selected
          ? 'border-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-primary)_16%,transparent)]'
          : 'hover:border-muted-foreground/40',
      )}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      {d.icon ? (
        <SchemaIcon svg={d.icon} className="h-4 w-4 shrink-0" style={{ color: tint.mark }} />
      ) : (
        <Box className="h-4 w-4 shrink-0" style={{ color: tint.mark }} />
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{d.name}</span>
      {d.coreRole === 'identity' && (
        <span title="Identity" className="shrink-0 text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" />
        </span>
      )}
      <NodeCommentPin
        domainId={d.domainId}
        anchorRef={`class.${d.name}`}
        kind="schema"
        excerpt={d.name}
      />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  )
}

export function GroupNode({ data }: NodeProps) {
  const d = data as GroupNodeData
  const setDomain = useUI((s) => s.setDomain)
  const toggleModule = useUI((s) => s.toggleModule)
  const selected = useUI((s) => s.domainId === d.domainId && s.selectedClass === `module.${d.path}`)
  const tint = moduleTint(d.hue)
  return (
    <div
      data-domain-id={d.domainId}
      className={cn(
        'relative h-full w-full rounded-lg border transition-[border-color,box-shadow]',
        selected && 'shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-primary)_14%,transparent)]',
        d.collapsed && 'cursor-pointer',
      )}
      style={{
        borderColor: selected ? 'var(--color-primary)' : tint.border,
        background: tint.surface,
      }}
    >
      <NodeCommentPin
        domainId={d.domainId}
        anchorRef={`module.${d.path}`}
        kind="section"
        excerpt={d.label}
      />
      {/* hidden handles so React Flow can anchor (rerouted) edges to a collapsed module box */}
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
      <div
        className="flex items-center gap-1 px-1.5 py-1.5 text-[12px]"
        style={{ color: tint.text }}
      >
        <button
          type="button"
          title={d.collapsed ? 'Show classes' : 'Hide classes'}
          onClick={(e) => {
            e.stopPropagation()
            if (d.onToggleModule) d.onToggleModule(d.domainId, d.path)
            else {
              if (useUI.getState().domainId !== d.domainId) setDomain(d.domainId)
              toggleModule(d.path)
            }
          }}
          className="shrink-0 rounded p-0.5 transition-colors hover:bg-foreground/5"
        >
          {d.collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        <span className="truncate font-semibold">{d.label}</span>
        <span className="ml-auto shrink-0 pr-1 text-[11px] tabular-nums opacity-70">
          {d.classCount}
        </span>
      </div>
    </div>
  )
}

// ── external (cross-domain) nodes ──

function ExtDomainNode({ data }: NodeProps) {
  const d = data as { name: string; origin: string; kind: 'kernel' | 'external'; icon?: string }
  return (
    <div className="h-full w-full rounded-lg border border-dashed bg-muted/40">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-muted-foreground">
        <span className="shrink-0">
          {d.icon ? <SchemaIcon svg={d.icon} className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
        </span>
        <span className="truncate text-[12px] font-semibold text-foreground/80">{d.name}</span>
        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider">{d.kind}</span>
      </div>
    </div>
  )
}

function ExtMemberNode({ data }: NodeProps) {
  const d = data as { name: string; kind: 'kernel' | 'external' }
  return (
    <div className="flex h-full w-full items-center gap-1.5 rounded-md border border-dashed bg-card px-2">
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <Box className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate text-[12px] font-medium text-foreground/80">{d.name}</span>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  )
}

/** The rectangle delimiting THIS domain — everything inside belongs to it; imported domains sit outside. */
function InternalRegionNode({ data }: NodeProps) {
  const d = data as { label: string }
  return (
    <div className="relative h-full w-full rounded-xl border border-dashed border-border">
      <span
        className="absolute -top-2 left-4 whitespace-nowrap px-2 text-[11px] font-medium text-muted-foreground"
        style={{ background: 'var(--color-canvas)' }}
      >
        {d.label}
      </span>
    </div>
  )
}

function CanvasCommentNode({ data }: NodeProps) {
  const d = data as CanvasCommentNodeData
  return (
    <CanvasCommentPin
      threads={d.comments}
      anchor={d.anchor}
      excerpt={d.excerpt}
      className="nodrag nopan"
    />
  )
}

export const schemaNodeTypes = {
  classNode: ClassNode,
  group: GroupNode,
  moduleNode: GroupNode,
  extDomain: ExtDomainNode,
  extMember: ExtMemberNode,
  internalRegion: InternalRegionNode,
  canvasComment: CanvasCommentNode,
}

export function CanvasCommentPin({
  threads,
  anchor,
  excerpt,
  className,
}: {
  threads: Comment[]
  anchor: AnchorRef
  excerpt: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  if (threads.length === 0) return null
  const status = threads.some((c) => c.status === 'open') ? 'open' : 'resolved'
  const orphaned = threads.some((c) => c.orphaned)
  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <button
          type="button"
          title="Schema canvas comments"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className={cn(
            'flex h-6 min-w-6 items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-semibold ring-2 ring-card transition-colors',
            status === 'open'
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground hover:bg-accent',
            orphaned && 'bg-destructive text-white hover:bg-destructive/90',
            className,
          )}
        >
          <MessageSquare className="h-3 w-3" />
          {threads.length}
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="center"
        className="w-80"
        onInteractOutside={(event) => {
          if (hasUnsentDraft(anchor.ref, threads)) event.preventDefault()
        }}
      >
        <ThreadPopover
          anchor={anchor}
          excerpt={excerpt}
          threads={threads}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
