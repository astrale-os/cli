import type { ReactNode } from 'react'

import { ChevronDown, ChevronRight, Eye, EyeOff, PanelLeftClose, Plus } from 'lucide-react'

import { AnchorButton } from '@/components/anchor'
import { useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { anchorData, domainAnchorRef } from '@/lib/targets'
import { cn } from '@/lib/utils'

import { useRailCollapse } from './sidebar'

/**
 * The rail's title bar and the rows under it.
 *
 * The workspace's domains are the rail's first level. It reads at the same height as the
 * work panel's tab bar on the other side of the screen because both navigate what is shown.
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
  /** Which domain's threads a comment dropped on this row belongs to. */
  domainId: string
  /** Selected only inside a mono-domain section such as Core or Process. */
  selected?: boolean
  onSelect?: () => void
  /** Present only where the rail carries a hierarchy under the row. */
  expanded?: boolean
  onToggleExpanded?: () => void
  /** Present only where the schema canvas can show or hide this domain. */
  visible?: boolean
  onToggleVisible?: () => void
  /** Something is selected inside a collapsed hierarchy. */
  showSelectionIndicator?: boolean
}

/**
 * One domain. In the schema rail, the eye is the only state-changing control: it says
 * whether the canvas draws the domain. Mono-domain sections instead select a row locally.
 */
export function DomainRow({
  origin,
  domainId,
  selected,
  onSelect,
  expanded,
  onToggleExpanded,
  visible,
  onToggleVisible,
  showSelectionIndicator,
}: DomainRowProps) {
  return (
    // Marked as a tree row so targeting mode can attach a thread to the whole domain.
    // It carries NO `data-domain-id`: that stamp means "this domain is on screen" to the
    // ask layer, and the rail lists domains the canvas does not draw. The owner rides on
    // the ANCHOR instead, which is a different claim — whose threads, not what is drawn.
    <div
      data-tree-row=""
      data-comment-outline-inset=""
      {...anchorData(domainAnchorRef(origin), origin, domainId)}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group relative flex min-h-10 items-center gap-1.5 px-2 py-1.5 transition-colors',
        selected
          ? 'bg-accent before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary'
          : 'hover:bg-accent/60',
        visible === false && 'text-muted-foreground/65',
      )}
    >
      {onToggleExpanded && (
        <button
          type="button"
          onClick={onToggleExpanded}
          title={expanded ? 'Collapse domain' : 'Expand domain'}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${origin}`}
          aria-expanded={expanded}
          className="-mx-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      )}

      {!onToggleExpanded && onToggleVisible && <span aria-hidden className="h-[18px] w-[18px]" />}

      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          title={`Show ${origin} in this section`}
          className={cn(
            'min-w-0 flex-1 truncate text-left text-[12px]',
            selected ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
          )}
        >
          {origin}
        </button>
      ) : (
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[12px] font-medium',
            visible === false ? 'text-muted-foreground/65' : 'text-foreground',
          )}
        >
          {origin}
        </span>
      )}

      {showSelectionIndicator && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
          title="Selected element in collapsed domain"
        />
      )}

      <AnchorButton
        domainId={domainId}
        anchorRef={{ ref: domainAnchorRef(origin), kind: 'section' }}
        excerpt={origin}
      />

      {onToggleVisible && (
        <button
          type="button"
          aria-pressed={visible}
          aria-label={`${visible ? 'Hide' : 'Show'} ${origin} on the canvas`}
          title={`${visible ? 'Hide' : 'Show'} on canvas`}
          onClick={onToggleVisible}
          className={cn(
            'grid h-7 w-7 shrink-0 place-items-center rounded-md border transition-all',
            visible
              ? 'border-primary/25 bg-primary/12 text-primary shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-primary)_8%,transparent)] hover:bg-primary/20'
              : 'border-transparent text-muted-foreground/55 hover:border-border hover:bg-accent hover:text-foreground',
          )}
        >
          {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
      )}
    </div>
  )
}

/**
 * A local selector for sections that can read exactly one domain. This selection affects
 * only the section that owns it; it never changes the agent, comments or schema canvas.
 */
export function DomainPicker({
  selectedId,
  onSelect,
  children,
}: {
  selectedId?: string
  onSelect: (domainId: string) => void
  children?: ReactNode
}) {
  const { data: domains } = useWorkspace()

  return (
    <div data-testid="domains-rail">
      {(domains ?? []).map((domain) => {
        const selected = domain.id === selectedId
        return (
          <section key={domain.id}>
            <DomainRow
              origin={domain.origin}
              domainId={domain.id}
              selected={selected}
              onSelect={() => onSelect(domain.id)}
            />
            {/* Nested, not partitioned: what hangs under a domain is one more level of the
                same tree, so it is indented under the name instead of boxed off from it. */}
            {selected && children && <div className="pl-3">{children}</div>}
          </section>
        )
      })}
    </div>
  )
}
