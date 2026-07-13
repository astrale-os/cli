import {
  Box,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FolderClosed,
  FolderOpen,
  Shapes,
  Spline,
  SquareDashed,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { AnchorButton } from '@/components/anchor'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { type MemberRef, type TreeNode } from './modules'
import { SchemaIcon } from './schema-icon'
import { isHidden, isMaterialized } from './visibility'

/** Does any member anywhere under `node` match the current selection? */
function subtreeHasSelected(node: TreeNode, selected?: string): boolean {
  if (!selected) return false
  if (node.members.some((m) => m.selectId === selected)) return true
  return node.children.some((c) => subtreeHasSelected(c, selected))
}

export function ModuleTree({
  root,
  selected,
  onSelect,
}: {
  root: TreeNode
  selected?: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="text-sm py-2">
      <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Modules
      </div>
      {root.children.map((c) => (
        <Branch key={c.path} node={c} depth={0} selected={selected} onSelect={onSelect} />
      ))}
      {root.members.map((m) => (
        <Member key={m.selectId} m={m} depth={1} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  )
}

function Branch({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode
  depth: number
  selected?: string
  onSelect: (id: string) => void
}) {
  const collapsedModules = useUI((s) => s.collapsedModules)
  const toggleModule = useUI((s) => s.toggleModule)
  const [localOpen, setLocalOpen] = useState(true)
  const moduleId = `module.${node.path}`
  const active = selected === moduleId
  const hasCanvasModule = node.members.length > 0

  // A folder with direct schema members owns a canvas module, so its collapse is
  // shared with the canvas. Pure parent folders only control the tree locally.
  // Either auto-reveals when the current selection lives beneath it.
  const open = hasCanvasModule
    ? !collapsedModules.includes(node.path) || subtreeHasSelected(node, selected)
    : localOpen || subtreeHasSelected(node, selected)
  const toggle = () => (hasCanvasModule ? toggleModule(node.path) : setLocalOpen((value) => !value))

  const pad = { paddingLeft: 8 + depth * 12 }
  const FolderIcon = open ? FolderOpen : FolderClosed
  return (
    <div>
      <div
        data-anchor-ref={moduleId}
        data-anchor-excerpt={node.path}
        className={cn(
          'flex items-center gap-0.5 pr-2 hover:bg-accent/50 rounded-md',
          active && 'bg-accent text-accent-foreground',
        )}
        style={pad}
      >
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-white/5"
          title={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={() => onSelect(moduleId)}
          className={cn(
            'flex items-center gap-1.5 flex-1 min-w-0 py-1 text-left font-bold',
            active && 'font-extrabold',
          )}
        >
          <FolderIcon
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: `oklch(0.78 0.12 ${node.hue})` }}
          />
          <span className="truncate">{node.name}</span>
        </button>
        <AnchorButton
          anchorRef={{ ref: moduleId, kind: 'section' }}
          excerpt={node.path}
          className="ml-1"
        />
      </div>
      {open && (
        <div>
          {node.children.map((c) => (
            <Branch
              key={c.path}
              node={c}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
          {node.members.map((m) => (
            <Member
              key={m.selectId}
              m={m}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Member({
  m,
  depth,
  selected,
  onSelect,
}: {
  m: MemberRef
  depth: number
  selected?: string
  onSelect: (id: string) => void
}) {
  const active = selected === m.selectId
  const isInterface = m.kind === 'interface'
  // `m.ref` (class.X / edge.X) is the hide-set key — NOT `m.selectId`, whose edges share the
  // class.X namespace and would collide with a same-named node class. Interfaces don't hide;
  // their per-element control is materialize (badge ⇄ canvas node), keyed by bare name.
  const hidden = useUI((s) => isHidden(m.ref, s.hidden))
  const toggleHidden = useUI((s) => s.toggleHidden)
  const materialized = useUI((s) => isMaterialized(m.name, s.materializedInterfaces))
  const toggleInterfaceMaterialized = useUI((s) => s.toggleInterfaceMaterialized)
  const dimmed = !isInterface && hidden // materialized = MORE visible, never dims the row
  const Icon = m.kind === 'interface' ? Shapes : m.kind === 'edge' ? Spline : Box
  const color =
    m.kind === 'interface'
      ? 'text-fuchsia-300'
      : m.kind === 'edge'
        ? 'text-amber-400'
        : 'text-sky-300'
  const ref = useRef<HTMLDivElement>(null)
  // Auto-scroll: when this row becomes the selected one, nudge it into view.
  // 'nearest' only scrolls if it's off-screen, so visible selections don't jump.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])
  return (
    <div
      ref={ref}
      data-anchor-ref={m.selectId}
      data-anchor-excerpt={`${m.kind} ${m.name}`}
      className={cn(
        'group w-full flex items-center pr-2 hover:bg-accent/50',
        active && 'bg-accent text-accent-foreground font-black',
        dimmed && 'opacity-50',
      )}
      style={{ paddingLeft: 8 + (depth + 1) * 12 + 12 }}
      title={`${m.kind} ${m.name}`}
    >
      <button
        type="button"
        onClick={() => onSelect(m.selectId)}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left font-extrabold"
      >
        {m.icon ? (
          <SchemaIcon svg={m.icon} className={cn('h-4 w-4 shrink-0', color)} />
        ) : (
          <Icon className={cn('h-3.5 w-3.5 shrink-0', color)} />
        )}
        <span className="truncate">{m.name}</span>
      </button>
      {isInterface ? (
        // interface control: materialize (badge ⇄ canvas node). A distinct affordance from the
        // class/edge hide-eye — a box-promote icon, tinted fuchsia when materialized — so the two
        // don't read identically. Active state stays visible so you can collapse back to a badge.
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            toggleInterfaceMaterialized(m.name)
          }}
          title={materialized ? 'Collapse to badge' : 'Show as node'}
          className={cn(
            'ml-1 shrink-0 rounded p-0.5 transition hover:bg-white/5',
            materialized
              ? 'text-fuchsia-300 opacity-100'
              : 'text-muted-foreground/60 opacity-0 hover:text-foreground group-hover:opacity-100',
          )}
        >
          {/* active = Box (promoted to a canvas node), NOT Shapes — Shapes is already the leading
              interface glyph, and two identical icons on one row would blur the toggle's affordance. */}
          {materialized ? (
            <Box className="h-3.5 w-3.5" />
          ) : (
            <SquareDashed className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            toggleHidden(m.ref)
          }}
          title={hidden ? 'Show in canvas' : 'Hide in canvas'}
          className={cn(
            'ml-1 shrink-0 rounded p-0.5 text-muted-foreground/60 transition hover:bg-white/5 hover:text-foreground',
            hidden ? 'opacity-100' : 'opacity-0 group-hover:opacity-100', // stays visible while hidden so you can un-hide
          )}
        >
          {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
      <AnchorButton
        anchorRef={{ ref: m.selectId, kind: 'schema' }}
        excerpt={`${m.kind} ${m.name}`}
        className="ml-1"
      />
    </div>
  )
}
