import type { AnchorRef, Comment } from '@shared/types'

import { Handle, type NodeProps, Position, useStore } from '@xyflow/react'
import { Box, ChevronDown, ChevronRight, Globe, MessageSquare, UserRound } from 'lucide-react'
import { useState } from 'react'

import { ThreadPopover } from '@/components/thread-popover'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import type { CanvasCommentNodeData } from './structure'

import { NodeCommentPin } from '../node-comment-pin'
import { type ClassNodeData, type GroupNodeData, type SchemaCoreRole } from '../projection'
import { SchemaIcon } from '../schema-icon'

// ── custom nodes ──

function ClassNode({ data }: NodeProps) {
  const d = data as ClassNodeData
  const selectClass = useUI((s) => s.selectClass)
  const setDomain = useUI((s) => s.setDomain)
  const selected = useUI((s) => s.domainId === d.domainId && s.selectedClass === `class.${d.name}`)
  // semantic zoom (level-of-detail): collapse to a title chip when zoomed out
  const zoom = useStore((s) => s.transform[2])
  const compact = zoom < 0.5
  const coreRoleClass = d.coreRole
    ? (
        {
          container: 'schema-core-container',
          identity: 'schema-core-identity',
        } satisfies Record<SchemaCoreRole, string>
      )[d.coreRole]
    : undefined
  return (
    <div
      data-domain-id={d.domainId}
      data-core-role={d.coreRole ?? undefined}
      className={cn(
        'relative rounded-lg border bg-card shadow-sm w-[160px] transition-shadow',
        coreRoleClass,
        selected ? 'ring-2 ring-primary' : 'hover:shadow-md',
      )}
      style={{ borderLeft: `3px solid oklch(0.72 0.15 ${d.hue})` }}
    >
      {d.coreRole === 'identity' && (
        <span title="Identity" className="schema-core-identity-icon">
          <UserRound className="h-3 w-3" />
        </span>
      )}
      <NodeCommentPin
        domainId={d.domainId}
        anchorRef={`class.${d.name}`}
        kind="schema"
        excerpt={d.name}
        className={d.coreRole === 'identity' ? 'top-6' : undefined}
      />
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="px-2.5 py-1.5">
        <div className="flex items-center gap-2">
          {d.icon ? (
            <span style={{ color: `oklch(0.82 0.14 ${d.hue})` }} className="shrink-0">
              <SchemaIcon svg={d.icon} className="h-6 w-6" />
            </span>
          ) : (
            <span
              className="h-2.5 w-2.5 rounded-sm shrink-0"
              style={{ background: `oklch(0.7 0.15 ${d.hue})` }}
            />
          )}
          <span className="text-sm font-extrabold truncate">{d.name}</span>
        </div>
        {!compact && d.bases.length > 0 && (
          <div className="rf-meta mt-1.5 flex flex-wrap gap-1">
            {d.bases.map((base) => (
              <span
                key={base}
                title={`extends ${base}`}
                className="rounded bg-fuchsia-500/15 px-1 py-0.5 font-mono text-[9px] text-fuchsia-300"
              >
                {base}
              </span>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  )
}

export function GroupNode({ data }: NodeProps) {
  const d = data as GroupNodeData
  const setDomain = useUI((s) => s.setDomain)
  const toggleModule = useUI((s) => s.toggleModule)
  const selected = useUI((s) => s.domainId === d.domainId && s.selectedClass === `module.${d.path}`)
  return (
    <div
      data-domain-id={d.domainId}
      className={cn(
        'relative w-full h-full rounded-xl border transition-shadow',
        selected ? 'ring-2 ring-primary' : d.collapsed && 'hover:shadow-md cursor-pointer',
      )}
      style={{
        borderColor: `oklch(0.55 0.1 ${d.hue} / 0.45)`,
        background: `oklch(0.5 0.12 ${d.hue} / ${d.collapsed ? 0.12 : 0.07})`,
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
        className="flex items-center gap-1 px-1.5 py-1.5 text-[13px]"
        style={{ color: `oklch(0.85 0.12 ${d.hue})` }}
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
          className="rounded p-0.5 hover:bg-white/10 shrink-0"
        >
          {d.collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        <span className="font-extrabold truncate">{d.label}</span>
        {d.collapsed && (
          <span className="ml-auto text-[10px] opacity-60 shrink-0 pr-1">{d.classCount}</span>
        )}
      </div>
    </div>
  )
}

// ── external (cross-domain) nodes ──

function ExtDomainNode({ data }: NodeProps) {
  const d = data as { name: string; origin: string; kind: 'kernel' | 'external'; icon?: string }
  const hue = d.kind === 'kernel' ? 285 : 158
  return (
    <div
      className="w-full h-full rounded-xl border border-dashed"
      style={{
        borderColor: `oklch(0.6 0.1 ${hue} / 0.55)`,
        background: `oklch(0.5 0.1 ${hue} / 0.06)`,
      }}
    >
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5"
        style={{ color: `oklch(0.84 0.11 ${hue})` }}
      >
        <span className="shrink-0">
          {d.icon ? <SchemaIcon svg={d.icon} className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
        </span>
        <span className="text-[13px] font-extrabold truncate">{d.name}</span>
        <span className="ml-auto text-[9px] uppercase tracking-wider opacity-60 shrink-0">
          {d.kind}
        </span>
      </div>
    </div>
  )
}

function ExtMemberNode({ data }: NodeProps) {
  const d = data as { name: string; kind: 'kernel' | 'external' }
  const hue = d.kind === 'kernel' ? 285 : 158
  return (
    <div
      className="w-full h-full rounded-lg border bg-card flex items-center gap-1.5 px-2 shadow-sm"
      style={{ borderLeft: `3px solid oklch(0.72 0.14 ${hue})` }}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <Box className="h-4 w-4 shrink-0" style={{ color: `oklch(0.78 0.13 ${hue})` }} />
      <span className="text-[12px] font-extrabold truncate">{d.name}</span>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  )
}

/** The big rectangle delimiting THIS domain — everything inside belongs to it; imported domains sit outside. */
function InternalRegionNode({ data }: NodeProps) {
  const d = data as { label: string }
  return (
    <div
      className="relative w-full h-full rounded-2xl border-2 border-dashed"
      style={{
        borderColor: 'oklch(0.62 0.04 264 / 0.38)',
        background: 'oklch(0.6 0.03 264 / 0.025)',
      }}
    >
      <span
        className="absolute -top-2.5 left-5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/55 whitespace-nowrap"
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
            'flex h-6 min-w-6 items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-bold shadow-md ring-2 ring-card transition-colors hover:brightness-110',
            status === 'open'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground',
            orphaned && 'bg-destructive text-white',
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
        onInteractOutside={(e) => e.preventDefault()}
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
