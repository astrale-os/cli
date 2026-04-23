import { Filter, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'

import type { ClassInfo } from '../lib/raw-to-business'

import { getClassColor } from '../lib/business-to-flow'
import { DEFAULT_HIDDEN_CLASSES, META_NODE_LABELS } from '../lib/kernel-fabric'

interface GraphLegendProps {
  nodeClasses: ClassInfo[]
  edgeClasses: ClassInfo[]
  hiddenClasses: Set<string>
  onToggleClass: (className: string) => void
  onSetHiddenClasses: (classes: Set<string>) => void
  hiddenDomains: Set<string>
  onSetHiddenDomains: (domains: Set<string>) => void
  onRefresh?: () => void
  refreshLoading?: boolean
}

const SCHEMA_WHITELIST = META_NODE_LABELS

function ClassChip({
  info,
  hidden,
  onToggle,
}: {
  info: ClassInfo
  hidden: boolean
  onToggle: () => void
}) {
  const color = getClassColor(info.name)
  return (
    <button
      onClick={onToggle}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all border',
        hidden
          ? 'opacity-40 border-border text-muted-foreground line-through'
          : 'border-transparent text-foreground',
      )}
    >
      <span
        className={cn('h-2.5 w-2.5 rounded-full shrink-0', color.dot, hidden && 'opacity-40')}
      />
      <span>{info.name}</span>
      <span className="text-muted-foreground/60">{info.count}</span>
    </button>
  )
}

function PresetButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded px-2 py-0.5 text-[10px] font-medium transition-colors border',
        active
          ? 'bg-accent text-accent-foreground border-accent'
          : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent/50',
      )}
    >
      {label}
    </button>
  )
}

export function GraphLegend({
  nodeClasses,
  edgeClasses,
  hiddenClasses,
  onToggleClass,
  onSetHiddenClasses,
  hiddenDomains,
  onSetHiddenDomains,
  onRefresh,
  refreshLoading,
}: GraphLegendProps) {
  const [open, setOpen] = useState(false)

  if (nodeClasses.length === 0 && edgeClasses.length === 0) return null

  const allClasses = [...nodeClasses, ...edgeClasses].map((c) => c.name)
  const hiddenCount = hiddenClasses.size
  const hasActiveFilters = hiddenCount > 0

  function applyPresetDefault() {
    onSetHiddenClasses(new Set(DEFAULT_HIDDEN_CLASSES))
  }

  function applyPresetSchema() {
    const hidden = new Set<string>()
    for (const name of allClasses) {
      if (!SCHEMA_WHITELIST.has(name)) hidden.add(name)
    }
    onSetHiddenClasses(hidden)
  }

  const isKernelHidden = hiddenDomains.has('kernel')

  function toggleKernelDomain() {
    if (isKernelHidden) {
      onSetHiddenDomains(new Set())
    } else {
      onSetHiddenDomains(new Set(['kernel']))
    }
  }

  const isDefault = setsEqual(hiddenClasses, DEFAULT_HIDDEN_CLASSES)
  const schemaSet = new Set(allClasses.filter((n) => !SCHEMA_WHITELIST.has(n)))
  const isSchema = setsEqual(hiddenClasses, schemaSet)

  if (!open) {
    return (
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-md border border-border bg-background/90 backdrop-blur-sm shadow-sm px-2.5 h-8">
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshLoading}
            title="Refresh"
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshLoading && 'animate-spin')} />
          </button>
        )}
        <button
          onClick={() => setOpen(true)}
          className={cn(
            'flex items-center gap-1.5 text-xs transition-colors',
            hasActiveFilters ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
          title="Filter graph classes"
        >
          <Filter className="h-3.5 w-3.5" />
          {hasActiveFilters && <span className="text-muted-foreground">{hiddenCount} hidden</span>}
        </button>
      </div>
    )
  }

  return (
    <div className="absolute top-3 right-3 z-10 rounded-md border border-border bg-background/90 backdrop-blur-sm shadow-sm p-2 space-y-1.5 max-w-[400px]">
      <div
        onClick={() => setOpen(false)}
        className="flex items-center gap-1 px-1 cursor-pointer"
        title="Collapse filters"
      >
        {onRefresh && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRefresh()
            }}
            disabled={refreshLoading}
            title="Refresh"
            className="text-muted-foreground hover:text-foreground disabled:opacity-50 mr-1"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshLoading && 'animate-spin')} />
          </button>
        )}
        <Filter className="h-3.5 w-3.5 text-muted-foreground mr-1" />
        <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
          <PresetButton label="Default" active={isDefault} onClick={applyPresetDefault} />
          <PresetButton label="Schema" active={isSchema} onClick={applyPresetSchema} />
          <PresetButton label="No Kernel" active={isKernelHidden} onClick={toggleKernelDomain} />
        </div>
      </div>
      {nodeClasses.length > 0 && (
        <div>
          <span className="text-[9px] font-medium uppercase text-muted-foreground tracking-wider px-1">
            Nodes
          </span>
          <div className="flex flex-wrap gap-0.5 mt-0.5">
            {nodeClasses.map((c) => (
              <ClassChip
                key={c.name}
                info={c}
                hidden={hiddenClasses.has(c.name)}
                onToggle={() => onToggleClass(c.name)}
              />
            ))}
          </div>
        </div>
      )}
      {edgeClasses.length > 0 && (
        <div>
          <span className="text-[9px] font-medium uppercase text-muted-foreground tracking-wider px-1">
            Edges
          </span>
          <div className="flex flex-wrap gap-0.5 mt-0.5">
            {edgeClasses.map((c) => (
              <ClassChip
                key={c.name}
                info={c}
                hidden={hiddenClasses.has(c.name)}
                onToggle={() => onToggleClass(c.name)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}
