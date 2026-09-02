import type { StudioCore, StudioCoreNode, StudioDataset, StudioSchemaBundle } from '@shared/types'

import { Box, ChevronDown, ChevronRight, Tag } from 'lucide-react'
import { useMemo, useState } from 'react'

import { cn } from '@/lib/utils'

import { classIcon, displayName, hueMapOf } from '../core-view/model'
import { moduleTint } from '../palette'
import { SchemaIcon } from '../schema-icon'

interface ClassGroup {
  className: string
  nodes: StudioCoreNode[]
}

function groupByClass(core: StudioCore): ClassGroup[] {
  const groups = new Map<string, StudioCoreNode[]>()
  for (const node of core.nodes) {
    const list = groups.get(node.className) ?? []
    list.push(node)
    groups.set(node.className, list)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([className, nodes]) => ({
      className,
      nodes: [...nodes].sort((a, b) => displayName(a).localeCompare(displayName(b))),
    }))
}

function NodeRow({
  node,
  bundle,
  hue,
  selectedPath,
  onSelect,
}: {
  node: StudioCoreNode
  bundle: StudioSchemaBundle
  hue: number
  selectedPath: string | null
  onSelect: (path: string | null) => void
}) {
  const icon = classIcon(bundle, node.className)
  return (
    <button
      type="button"
      data-tree-row=""
      onClick={() => onSelect(node.path)}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md py-1 pl-7 pr-2 text-left min-w-0 hover:bg-accent',
        selectedPath === node.path && 'bg-accent',
      )}
    >
      <span style={{ color: moduleTint(hue).mark }} className="shrink-0">
        {icon ? <SchemaIcon svg={icon} className="h-4 w-4" /> : <Box className="h-3.5 w-3.5" />}
      </span>
      <span className="truncate text-[13px] font-medium">{displayName(node)}</span>
      <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">{node.path}</span>
    </button>
  )
}

function ClassGroupRows({
  group,
  bundle,
  hue,
  selectedPath,
  onSelect,
}: {
  group: ClassGroup
  bundle: StudioSchemaBundle
  hue: number
  selectedPath: string | null
  onSelect: (path: string | null) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-0.5 rounded-md py-1 pl-1.5 pr-2 text-left hover:bg-accent"
        title={open ? 'Collapse' : 'Expand'}
      >
        <span className="shrink-0 p-0.5 text-muted-foreground">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: moduleTint(hue).mark }}
        />
        <span className="truncate text-[12px] font-semibold">{group.className}</span>
        <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">
          {group.nodes.length}
        </span>
      </button>
      {open &&
        group.nodes.map((node) => (
          <NodeRow
            key={node.path}
            node={node}
            bundle={bundle}
            hue={hue}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  )
}

/** The rail under the picker: every record of the selected Dataset, grouped by Class. */
export function DatasetTree({
  dataset,
  core,
  bundle,
  selectedPath,
  onSelect,
}: {
  dataset: StudioDataset
  core: StudioCore
  bundle: StudioSchemaBundle
  selectedPath: string | null
  onSelect: (path: string | null) => void
}) {
  const hues = useMemo(() => hueMapOf(core), [core])
  const groups = useMemo(() => groupByClass(core), [core])
  const variables = useMemo(() => Object.entries(dataset.variables), [dataset])

  return (
    <div className="text-sm py-2">
      <div className="flex items-center gap-1.5 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Box className="h-3.5 w-3.5" /> Records
      </div>
      {groups.length === 0 ? (
        <p className="px-3 pt-2 text-[12px] text-muted-foreground">This Dataset holds no Node.</p>
      ) : (
        groups.map((group) => (
          <ClassGroupRows
            key={group.className}
            group={group}
            bundle={bundle}
            hue={hues.get(group.className) ?? 264}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))
      )}
      {variables.length > 0 && (
        <>
          <div className="mt-3 flex items-center gap-1.5 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Tag className="h-3.5 w-3.5" /> Entry points
          </div>
          {variables.map(([name, ids]) => (
            <button
              key={name}
              type="button"
              onClick={() => onSelect(ids[0] ?? null)}
              className="flex w-full items-center gap-1.5 rounded-md py-1 pl-3 pr-2 text-left hover:bg-accent"
              title={ids.join(', ')}
            >
              <span className="truncate text-[13px] font-medium">{name}</span>
              <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">
                {ids.length === 1 ? ids[0] : `${ids.length} nodes`}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
