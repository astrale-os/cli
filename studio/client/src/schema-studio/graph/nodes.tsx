import type { AnchorRef, Comment } from '@shared/types'

import { Handle, type NodeProps, Position } from '@xyflow/react'
import {
  AppWindow,
  Box,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  FileCode2,
  Fingerprint,
  Globe,
  type LucideIcon,
  MessageSquare,
  Play,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { type CSSProperties, useState } from 'react'

import { hasUnsentDraft } from '@/components/thread'
import { ThreadPopover } from '@/components/thread-popover'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { ViewModal } from '@/components/view-modal'
import { openCommentThreads } from '@/lib/comments'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'
import { driftLabel } from '@/lib/views'

import type { CanvasCommentNodeData } from './structure'

import { type KernelRole } from '../inheritance'
import { NodeCommentPin } from '../node-comment-pin'
import { CLASS_H, CLASS_W, VIEW_H, VIEW_W, moduleTint } from '../palette'
import { type ClassNodeData, type GroupNodeData } from '../projection'
import { SchemaIcon } from '../schema-icon'
import { type ViewNodeData, viewNodeId } from '../view-graph'

// ── custom nodes ──

/**
 * What a Class IS, in one glyph each: a principal, a callable. `Zap` is already how the
 * rest of the Studio draws something that runs (actions, methods), so a Class that IS one
 * wears the same mark; the fingerprint is the identity vocabulary and is used nowhere else.
 */
const ROLE_GLYPHS: Record<KernelRole, { icon: LucideIcon; label: string }> = {
  identity: { icon: Fingerprint, label: 'Identity' },
  function: { icon: Zap, label: 'Function' },
}

function ClassNode({ data }: NodeProps) {
  const d = data as ClassNodeData
  const selected = useUI((s) => s.domainId === d.domainId && s.selectedClass === `class.${d.name}`)
  // The projection already applied the reader's choice: `parents` is empty while the
  // inheritance EDGES are drawn, since the chips below would only repeat them.
  const parents = d.parents ?? []
  const roles = d.roles ?? []
  const tint = moduleTint(d.hue)
  return (
    <div
      data-domain-id={d.domainId}
      data-kernel-roles={roles.length > 0 ? roles.join(' ') : undefined}
      // the module colour is a left border, not an inset bar: the card can't clip
      // its own comment pin (which sits on the corner) with `overflow-hidden`.
      // Selection paints in the card's OWN hue — a generic accent would tell you
      // that something is selected but not which family it belongs to. `--node-tint`
      // carries the same hue to focus.css, which rings a picked edge's endpoints and
      // the neighbours of a focused node.
      //
      // Selected, the ring is the SAME 3px everywhere — including the left, where the
      // module bar would otherwise stack under it and make one side twice as heavy. The
      // bar drops to a hairline and its 2px are handed to the padding, so the card's
      // contents do not shift by a pixel on the way in or out of selection.
      style={
        {
          width: CLASS_W,
          height: CLASS_H,
          borderLeftWidth: selected ? 1 : 3,
          borderLeftColor: tint.mark,
          paddingLeft: selected ? 12 : 10,
          '--node-tint': tint.mark,
          ...(selected
            ? {
                borderColor: tint.mark,
                background: tint.wash,
                // One hard ring in the card's own hue — no blur and no drop shadow. A soft
                // halo reads as a smudge once the canvas is zoomed out, and the shadow made
                // the card look like it had lifted off the module box it belongs to.
                boxShadow: `0 0 0 2px ${tint.mark}`,
              }
            : null),
        } as CSSProperties
      }
      className={cn(
        'relative flex items-center gap-2 rounded-md border bg-card pr-2',
        'transition-[border-color,box-shadow,background-color] duration-150',
        !selected && 'hover:border-muted-foreground/40',
      )}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      {d.icon ? (
        <SchemaIcon svg={d.icon} className="h-4 w-4 shrink-0" style={{ color: tint.mark }} />
      ) : (
        <Box className="h-4 w-4 shrink-0" style={{ color: tint.mark }} />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-tight">{d.name}</div>
        {/* With the inheritance edges off, the card carries that fact itself: one chip per
            class it extends, under the name where it does not eat into it. `↳` says
            "extends" in the width the word would not fit, and the chips share the row —
            each elides rather than all but the first hiding behind a `+2`. */}
        {parents.length > 0 && (
          <div className="mt-px flex items-center gap-1">
            <CornerDownRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/60" />
            {parents.map((parent) => (
              <span
                key={parent}
                className="min-w-0 truncate rounded-sm bg-muted px-1 text-[10px] leading-[14px] text-muted-foreground"
              >
                {parent}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* A role is inherited whole, so it is read off the WHOLE chain and shown even when
          the parent that conferred it is several hops away and nowhere on the card. It is
          a glyph rather than a chip: what a Class is stays legible zoomed out, where a word
          would not be, and it never competes with the name for the row. */}
      {roles.map((role) => {
        const Glyph = ROLE_GLYPHS[role].icon
        // the tooltip rides on the span: `title` on an <svg> is not the one browsers show
        return (
          <span key={role} title={ROLE_GLYPHS[role].label} className="shrink-0">
            <Glyph className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        )
      })}
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
      className="relative h-full w-full rounded-lg border transition-[border-color,box-shadow]"
      style={
        {
          borderColor: selected ? tint.mark : tint.border,
          background: tint.surface,
          '--node-tint': tint.mark,
          // same hard ring as a selected class card, so the two selections read as one idea
          ...(selected ? { boxShadow: `0 0 0 2px ${tint.mark}` } : null),
        } as CSSProperties
      }
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

// ── views ──

/**
 * A declared view, on the canvas next to what it renders. Deliberately NOT a card:
 * a pill in the view hue reads as a different kind of thing than the class boxes it
 * hangs off, at any zoom. Clicking it runs the view — that is what a view is for.
 */
function ViewNode({ data }: NodeProps) {
  const d = data as ViewNodeData
  const [open, setOpen] = useState(false)
  const view = d.view
  const drift = driftLabel(view.drift)
  // AppWindow is the view glyph; Globe would collide with the imported-domain boxes.
  const KindIcon = view.kind === 'inline-html' ? FileCode2 : AppWindow
  return (
    <div
      data-domain-id={d.domainId}
      data-anchor-ref={viewNodeId(view.slug)}
      data-anchor-excerpt={view.slug}
      style={{ width: VIEW_W, height: VIEW_H }}
      className="relative"
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <button
        type="button"
        title={[`Open ${view.slug}`, view.mount, drift?.text].filter(Boolean).join(' · ')}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        className={cn(
          'group flex h-full w-full items-center gap-1.5 rounded-full border px-2.5',
          'border-schema-view/45 bg-schema-view/10 text-schema-view',
          'transition-colors hover:bg-schema-view/20',
        )}
      >
        <KindIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left text-[12px] font-medium">
          {view.slug}
        </span>
        {drift?.tone === 'warn' ? (
          <TriangleAlert className="h-3 w-3 shrink-0 text-warning" />
        ) : (
          <Play className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </button>
      <NodeCommentPin
        domainId={d.domainId}
        anchorRef={viewNodeId(view.slug)}
        kind="section"
        excerpt={view.slug}
      />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
      {open && <ViewModal domainId={d.domainId} view={view} open={open} onOpenChange={setOpen} />}
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
  viewNode: ViewNode,
  group: GroupNode,
  moduleNode: GroupNode,
  extDomain: ExtDomainNode,
  extMember: ExtMemberNode,
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
  const openThreads = openCommentThreads(threads)
  if (openThreads.length === 0) return null
  const orphaned = openThreads.some((c) => c.orphaned)
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
            'bg-primary text-primary-foreground hover:bg-primary/90',
            orphaned && 'bg-destructive text-white hover:bg-destructive/90',
            className,
          )}
        >
          <MessageSquare className="h-3 w-3" />
          {openThreads.length}
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="center"
        className="w-80"
        onInteractOutside={(event) => {
          if (hasUnsentDraft(anchor.ref, openThreads)) event.preventDefault()
        }}
      >
        <ThreadPopover
          anchor={anchor}
          excerpt={excerpt}
          threads={openThreads}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
