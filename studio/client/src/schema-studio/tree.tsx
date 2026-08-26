import {
  Box,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FolderClosed,
  FolderOpen,
  Spline,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { AnchorButton } from '@/components/anchor'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { type MemberRef, type TreeNode } from './modules'
import { moduleTint } from './palette'
import { SchemaIcon } from './schema-icon'
import { isHidden } from './visibility'

export interface ModuleTreeControls {
  domainId: string
  collapsedModules: string[]
  hidden: Record<string, true>
  toggleModule: (path: string) => void
  toggleHidden: (ref: string) => void
}

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
  controls,
}: {
  root: TreeNode
  selected?: string
  onSelect: (id: string) => void
  controls?: ModuleTreeControls
}) {
  return (
    <div className="py-2 text-[13px]" data-domain-id={controls?.domainId}>
      <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Modules
      </div>
      {root.children.map((c) => (
        <Branch
          key={c.path}
          node={c}
          depth={0}
          selected={selected}
          onSelect={onSelect}
          controls={controls}
        />
      ))}
      {root.members.map((m) => (
        <Member
          key={m.selectId}
          m={m}
          depth={1}
          selected={selected}
          onSelect={onSelect}
          controls={controls}
        />
      ))}
    </div>
  )
}

function Branch({
  node,
  depth,
  selected,
  onSelect,
  controls,
}: {
  node: TreeNode
  depth: number
  selected?: string
  onSelect: (id: string) => void
  controls?: ModuleTreeControls
}) {
  const storeCollapsedModules = useUI((s) => s.collapsedModules)
  const storeToggleModule = useUI((s) => s.toggleModule)
  const collapsedModules = controls?.collapsedModules ?? storeCollapsedModules
  const toggleModule = controls?.toggleModule ?? storeToggleModule
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
          'flex items-center gap-0.5 rounded-md pr-2 hover:bg-accent',
          active && 'bg-accent',
        )}
        style={pad}
      >
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          title={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={() => onSelect(moduleId)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left font-medium',
            active && 'font-semibold',
          )}
        >
          <FolderIcon
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: moduleTint(node.hue).mark }}
          />
          <span className="truncate">{node.name}</span>
        </button>
        <AnchorButton
          domainId={controls?.domainId}
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
              controls={controls}
            />
          ))}
          {node.members.map((m) => (
            <Member
              key={m.selectId}
              m={m}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              controls={controls}
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
  controls,
}: {
  m: MemberRef
  depth: number
  selected?: string
  onSelect: (id: string) => void
  controls?: ModuleTreeControls
}) {
  const active = selected === m.selectId
  // `m.ref` (class.X / edge.X) is the hide-set key — NOT `m.selectId`, whose edges share the
  // class.X namespace and would collide with a same-named node class.
  const storeHidden = useUI((s) => isHidden(m.ref, s.hidden))
  const storeToggleHidden = useUI((s) => s.toggleHidden)
  const hidden = controls ? isHidden(m.ref, controls.hidden) : storeHidden
  const toggleHidden = controls?.toggleHidden ?? storeToggleHidden
  const dimmed = hidden
  const Icon = m.kind === 'edge' ? Spline : Box
  const color = m.kind === 'edge' ? 'text-schema-edge' : 'text-schema-node'
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
        'group flex w-full items-center rounded-md pr-2 hover:bg-accent',
        active && 'bg-accent',
        dimmed && 'opacity-45',
      )}
      style={{ paddingLeft: 8 + (depth + 1) * 12 + 12 }}
      title={`${m.kind} ${m.name}`}
    >
      <button
        type="button"
        onClick={() => onSelect(m.selectId)}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left',
          active && 'font-semibold',
        )}
      >
        {m.icon ? (
          <SchemaIcon svg={m.icon} className={cn('h-4 w-4 shrink-0', color)} />
        ) : (
          <Icon className={cn('h-3.5 w-3.5 shrink-0', color)} />
        )}
        <span className="truncate">{m.name}</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggleHidden(m.ref)
        }}
        title={hidden ? 'Show in canvas' : 'Hide in canvas'}
        className={cn(
          'ml-1 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground',
          hidden ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <AnchorButton
        domainId={controls?.domainId}
        anchorRef={{ ref: m.selectId, kind: 'schema' }}
        excerpt={`${m.kind} ${m.name}`}
        className="ml-1"
      />
    </div>
  )
}
