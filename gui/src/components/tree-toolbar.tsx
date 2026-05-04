import { Button, Checkbox, ToggleGroup, ToggleGroupItem } from '@astrale-os/ui-components'
import { FolderTree, Link2, Loader2, PanelLeftClose, RefreshCw, Shield } from 'lucide-react'

import { paletteKeyForEdgeKind, swatchClassName, type ViewMode } from './tree/view-model'

type TreeToolbarProps = {
  mode: ViewMode | null
  onModeChange(mode: ViewMode | null): void
  selectedIsIdentity: boolean
  autoExpand: boolean
  onAutoExpandToggle(): void
  canAutoExpand: boolean
  onRefresh?(): void
  refreshDisabled?: boolean
  refreshTitle?: string
  isRefreshing?: boolean
  onCollapse?(): void
}

// Active state: subtle primary-color tint instead of the aggressive saturated
// fill. The theme doesn't define `--accent`, so we can't rely on the
// component default (`bg-accent`) — it would render as transparent.
const activeToggleClass =
  'data-[state=on]:bg-primary/10 data-[state=on]:text-primary data-[state=on]:hover:bg-primary/20'

export function TreeToolbar({
  mode,
  onModeChange,
  selectedIsIdentity,
  autoExpand,
  onAutoExpandToggle,
  canAutoExpand,
  onRefresh,
  refreshDisabled,
  refreshTitle,
  isRefreshing,
  onCollapse,
}: TreeToolbarProps) {
  return (
    <div className="shrink-0 bg-background border-b border-border">
      <div className="px-2 py-1.5 flex items-center gap-1">
        <ToggleGroup
          type="single"
          size="sm"
          spacing={1}
          value={mode ?? ''}
          onValueChange={(v) => onModeChange(v ? (v as ViewMode) : null)}
        >
          <ToggleGroupItem
            value="relations"
            title="Relations"
            aria-label="Relations"
            className={activeToggleClass}
          >
            <Link2 className="w-3.5 h-3.5" />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="permissions"
            title={
              selectedIsIdentity
                ? 'Permissions'
                : 'Permissions — select a User, Group, or Root to enable'
            }
            aria-label="Permissions"
            disabled={!selectedIsIdentity}
            className={activeToggleClass}
          >
            <Shield className="w-3.5 h-3.5" />
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="ml-auto flex items-center gap-1">
          {canAutoExpand && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onAutoExpandToggle}
              title={
                autoExpand
                  ? 'Restore previous tree expansion'
                  : 'Expand all folders leading to matches'
              }
              aria-pressed={autoExpand}
              className={autoExpand ? 'bg-primary/10 text-primary hover:bg-primary/20' : ''}
            >
              <FolderTree className="w-3.5 h-3.5" />
            </Button>
          )}
          {mode && onRefresh && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onRefresh}
              disabled={refreshDisabled}
              title={refreshTitle ?? 'Refresh view'}
            >
              {isRefreshing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
            </Button>
          )}
          {onCollapse && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onCollapse}
              title="Collapse graph panel"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

type TreeLegendProps = {
  mode: ViewMode | null
  availableEdgeKinds: string[]
  selectedEdgeKinds: Set<string>
  onEdgeKindToggle(kind: string): void
}

export function TreeLegend({
  mode,
  availableEdgeKinds,
  selectedEdgeKinds,
  onEdgeKindToggle,
}: TreeLegendProps) {
  if (mode === 'relations' && availableEdgeKinds.length > 0) {
    return (
      <div className="shrink-0 bg-background border-t border-border px-2 py-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
        {availableEdgeKinds.map((kind) => {
          const swatch = swatchClassName(paletteKeyForEdgeKind(kind))
          return (
            <label
              key={kind}
              className="flex items-center gap-1.5 text-[10px] cursor-pointer select-none"
            >
              <Checkbox
                checked={selectedEdgeKinds.has(kind)}
                onCheckedChange={() => onEdgeKindToggle(kind)}
              />
              <span className={`w-2 h-2 rounded-sm shrink-0 ${swatch}`} />
              <span className="font-mono">{kind}</span>
            </label>
          )
        })}
      </div>
    )
  }

  if (mode === 'permissions') {
    return (
      <div className="shrink-0 bg-background border-t border-border px-2 py-1 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-emerald-500" />
          direct
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-violet-400" />
          via union (extends_with)
        </span>
      </div>
    )
  }

  return null
}
