import { Button, Checkbox, ToggleGroup, ToggleGroupItem } from '@astrale-os/ui-components'
import { FolderTree, GitBranch, Link2, Shield } from 'lucide-react'

import { paletteKeyForEdgeKind, swatchClassName, type ViewMode } from './tree/view-model'

type TreeToolbarProps = {
  mode: ViewMode | null
  onModeChange(mode: ViewMode | null): void
  selectedIsIdentity: boolean
  availableEdgeKinds: string[]
  selectedEdgeKinds: Set<string>
  onEdgeKindToggle(kind: string): void
  autoExpand: boolean
  onAutoExpandToggle(): void
  canAutoExpand: boolean
}

const activeToggleClass =
  'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=on]:shadow-sm'

export function TreeToolbar({
  mode,
  onModeChange,
  selectedIsIdentity,
  availableEdgeKinds,
  selectedEdgeKinds,
  onEdgeKindToggle,
  autoExpand,
  onAutoExpandToggle,
  canAutoExpand,
}: TreeToolbarProps) {
  return (
    <div className="sticky top-0 z-10 bg-background border-b border-border">
      <div className="px-2 py-1.5 flex items-center gap-1">
        <ToggleGroup
          type="single"
          size="sm"
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
          <ToggleGroupItem
            value="inheritance"
            title="Inheritance"
            aria-label="Inheritance"
            className={activeToggleClass}
          >
            <GitBranch className="w-3.5 h-3.5" />
          </ToggleGroupItem>
        </ToggleGroup>

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
            className={
              autoExpand
                ? 'ml-auto bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
                : 'ml-auto'
            }
          >
            <FolderTree className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {mode === 'relations' && availableEdgeKinds.length > 0 && (
        <div className="px-2 py-1.5 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-border">
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
      )}

      {mode === 'permissions' && (
        <div className="px-2 py-1 flex items-center gap-3 text-[10px] border-t border-border text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-emerald-500" />
            direct
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-violet-400" />
            via union (extends_with)
          </span>
        </div>
      )}
    </div>
  )
}
