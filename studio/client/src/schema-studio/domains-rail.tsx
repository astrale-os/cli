import type { ReactNode } from 'react'

import { Check, ChevronDown, ChevronRight, PanelLeftClose, Plus } from 'lucide-react'

import { useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import { useRailCollapse } from './sidebar'
import { useCanvasDomains } from './workspace/canvas-selection'

/**
 * The rail's title bar and the rows under it.
 *
 * The workspace's domains are the rail's first level — which one you are working in, and
 * which ones the canvas draws. It reads at the same height as the work panel's tab bar on
 * the other side of the screen, because it answers the same kind of question: what am I
 * looking at.
 */
export function DomainsRailHeader() {
  // The composer it opens is centred over the whole studio, so it is mounted at
  // the app's root (`NewDomainDialog`); the rail only asks for it.
  const setNewDomainOpen = useUI((state) => state.setNewDomainOpen)
  const rail = useRailCollapse()

  return (
    <header className="flex h-10 shrink-0 items-center gap-0.5 border-b px-3">
      <h2 className="mr-auto text-[13px] font-semibold">Domains</h2>
      <button
        type="button"
        title="New domain"
        aria-label="New domain"
        onClick={() => setNewDomainOpen(true)}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
      {rail && (
        <button
          type="button"
          title="Hide domains"
          aria-label="Hide domains"
          aria-expanded
          onClick={rail.collapse}
          className="-mr-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      )}
    </header>
  )
}

export interface DomainRowProps {
  origin: string
  /** The domain everything else in the studio is about. */
  active: boolean
  onActivate: () => void
  /** Present only where the rail carries a hierarchy under the row. */
  expanded?: boolean
  onToggleExpanded?: () => void
  /** Present only where a canvas composes several domains at once. */
  checked?: boolean
  onToggleChecked?: () => void
  /** Something is selected inside a collapsed hierarchy. */
  showSelectionIndicator?: boolean
}

/** One domain: check it onto the canvas, click its name to work in it. */
export function DomainRow({
  origin,
  active,
  onActivate,
  expanded,
  onToggleExpanded,
  checked,
  onToggleChecked,
  showSelectionIndicator,
}: DomainRowProps) {
  return (
    // The accent spine identifies the active domain. Marked as a tree row so a press on
    // its padding reads as part of the row, not as "nothing here" on the rail behind it.
    // It carries NO `data-domain-id`: that stamp means "this domain is on screen" to the
    // ask layer, and the rail lists domains the canvas does not draw.
    <div
      data-tree-row=""
      aria-current={active ? 'true' : undefined}
      className={cn(
        'group relative flex items-center gap-1.5 px-2 py-2 transition-colors',
        active
          ? 'bg-accent before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary'
          : 'hover:bg-accent/60',
      )}
    >
      {onToggleExpanded && (
        <button
          type="button"
          onClick={onToggleExpanded}
          title={expanded ? 'Collapse domain' : 'Expand domain'}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${origin}`}
          aria-expanded={expanded}
          className="-ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      )}

      {onToggleChecked && (
        <button
          type="button"
          role="checkbox"
          aria-checked={checked}
          aria-label={`${checked ? 'Remove' : 'Add'} ${origin} ${checked ? 'from' : 'to'} the canvas`}
          title={
            checked
              ? active
                ? 'Remove from canvas — you keep working in it'
                : 'Remove from canvas'
              : 'Add to canvas'
          }
          onClick={onToggleChecked}
          className={cn(
            'grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors',
            checked
              ? 'border-primary bg-primary text-primary-foreground hover:border-primary/70 hover:bg-primary/85'
              : 'border-input text-transparent hover:border-primary/60',
          )}
        >
          <Check className="h-2.5 w-2.5" />
        </button>
      )}

      <button
        type="button"
        onClick={onActivate}
        title={`Work in ${origin}`}
        className={cn(
          'min-w-0 flex-1 truncate text-left text-[12px]',
          active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
        )}
      >
        {origin}
      </button>

      {showSelectionIndicator && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
          title="Selected element in collapsed domain"
        />
      )}
    </div>
  )
}

/**
 * The plain reading of the same list, for the canvases that show ONE domain at a time:
 * no checkbox — there is no composition to make. `children` is whatever that canvas puts
 * under the domain it is about.
 */
export function DomainPicker({ children }: { children?: ReactNode }) {
  const { data: domains } = useWorkspace()
  const domainId = useUI((state) => state.domainId)
  const { requestActivate } = useCanvasDomains()

  return (
    <div data-testid="domains-rail">
      {(domains ?? []).map((domain) => {
        const active = domain.id === domainId
        return (
          <section key={domain.id}>
            <DomainRow
              origin={domain.origin}
              active={active}
              onActivate={() => requestActivate(domain.id, domain.origin)}
            />
            {/* Nested, not partitioned: what hangs under a domain is one more level of the
                same tree, so it is indented under the name instead of boxed off from it. */}
            {active && children && <div className="pl-3">{children}</div>}
          </section>
        )
      })}
    </div>
  )
}
