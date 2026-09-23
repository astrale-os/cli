import {
  AppWindow,
  Box,
  Braces,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FolderClosed,
  FolderOpen,
  type LucideIcon,
  ShieldCheck,
  Spline,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { AnchorButton } from '@/components/anchor'
import { cn } from '@/lib/utils'

import type { MemberKind, MemberRef, TreeNode } from './modules'

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
  indent = 0,
}: {
  root: TreeNode
  selected?: string
  onSelect: (id: string) => void
  controls: ModuleTreeControls
  /**
   * Pixels every row is pushed right by. The rail hangs this tree under the domain row
   * that owns it, and one continuous hierarchy means the modules nest under that name
   * rather than restarting at the rail's edge.
   */
  indent?: number
}) {
  return (
    <div className="pb-1.5 text-[13px]" data-domain-id={controls.domainId}>
      <Level
        node={root}
        depth={0}
        indent={indent}
        selected={selected}
        onSelect={onSelect}
        controls={controls}
      />
    </div>
  )
}

interface LevelProps {
  depth: number
  indent: number
  selected?: string
  onSelect: (id: string) => void
  controls: ModuleTreeControls
}

/** One level of the tree: a node's sub-folders first, then its own members. */
function Level({ node, ...props }: LevelProps & { node: TreeNode }) {
  return (
    <>
      {node.children.map((c) => (
        <Branch key={c.path} node={c} {...props} />
      ))}
      {node.members.map((m) => (
        <Member key={m.selectId} m={m} {...props} />
      ))}
    </>
  )
}

function Branch({
  node,
  depth,
  indent,
  selected,
  onSelect,
  controls,
}: LevelProps & { node: TreeNode }) {
  const [localOpen, setLocalOpen] = useState(true)
  const moduleId = `module.${node.path}`
  const active = selected === moduleId
  const hasCanvasModule = node.members.some(
    (member) => member.kind === 'class' || member.kind === 'edge',
  )

  // A folder with direct schema members owns a canvas module, so its collapse is
  // shared with the canvas. Pure parent folders only control the tree locally.
  // Either auto-reveals when the current selection lives beneath it.
  const open = hasCanvasModule
    ? !controls.collapsedModules.includes(node.path) || subtreeHasSelected(node, selected)
    : localOpen || subtreeHasSelected(node, selected)
  const toggle = () =>
    hasCanvasModule ? controls.toggleModule(node.path) : setLocalOpen((value) => !value)

  const pad = { paddingLeft: indent + 8 + depth * 12 }
  const FolderIcon = open ? FolderOpen : FolderClosed
  return (
    <div data-module-path={node.path}>
      <div
        data-tree-row=""
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
          domainId={controls.domainId}
          anchorRef={{ ref: moduleId, kind: 'section' }}
          excerpt={node.path}
          className="ml-1"
        />
      </div>
      {open && (
        <div>
          <Level
            node={node}
            depth={depth + 1}
            indent={indent}
            selected={selected}
            onSelect={onSelect}
            controls={controls}
          />
        </div>
      )}
    </div>
  )
}

const MEMBER_ICONS: Record<MemberKind, LucideIcon> = {
  class: Box,
  edge: Spline,
  policy: ShieldCheck,
  function: Braces,
  view: AppWindow,
}

const MEMBER_COLORS: Record<MemberKind, string> = {
  class: 'text-schema-node',
  edge: 'text-schema-edge',
  policy: 'text-success',
  function: 'text-schema-function',
  view: 'text-schema-view',
}

function Member({ m, depth, indent, selected, onSelect, controls }: LevelProps & { m: MemberRef }) {
  const active = selected === m.selectId
  // `m.ref` (class.X / edge.X) is the hide-set key — NOT `m.selectId`, whose edges share the
  // class.X namespace and would collide with a same-named node class.
  const hidden = isHidden(m.ref, controls.hidden)
  const canvasMember = m.kind === 'class' || m.kind === 'edge'
  const Icon = MEMBER_ICONS[m.kind]
  const color = MEMBER_COLORS[m.kind]
  const ref = useRef<HTMLDivElement>(null)
  // Auto-scroll: when this row becomes the selected one, nudge it into view.
  // 'nearest' only scrolls if it's off-screen, so visible selections don't jump.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])
  return (
    <div
      ref={ref}
      data-tree-row=""
      data-anchor-ref={m.kind === 'policy' ? undefined : m.ref}
      data-anchor-excerpt={`${m.kind} ${m.name}`}
      className={cn(
        'group flex w-full items-center rounded-md pr-2 hover:bg-accent',
        active && 'bg-accent',
        hidden && 'opacity-45',
      )}
      style={{ paddingLeft: indent + 26 + depth * 12 }}
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
      {canvasMember && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            controls.toggleHidden(m.ref)
          }}
          title={hidden ? 'Show in canvas' : 'Hide in canvas'}
          className={cn(
            'ml-1 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground',
            hidden ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      )}
      {m.kind !== 'policy' && (
        <AnchorButton
          domainId={controls.domainId}
          anchorRef={{ ref: m.ref, kind: m.kind === 'view' ? 'section' : 'schema' }}
          excerpt={`${m.kind} ${m.name}`}
          className="ml-1"
        />
      )}
    </div>
  )
}
