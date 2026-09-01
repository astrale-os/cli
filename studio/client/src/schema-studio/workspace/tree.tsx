import { useState } from 'react'

import { useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

import type { WorkspaceDomainProjection } from './projection'

import { DomainRow } from '../domains-rail'
import { buildModuleTree } from '../modules'
import { ModuleTree, type ModuleTreeControls } from '../tree'
import { useCanvasDomains } from './canvas-selection'
import { useSchemaWorkspace } from './store'

/** The dot that keeps a selection discoverable when its domain's hierarchy is closed. */
export function shouldShowDomainSelectionIndicator({
  holdsSelection,
  closed,
  selected,
}: {
  /** the selection belongs to THIS domain — not the same thing as being active */
  holdsSelection: boolean
  closed: boolean
  selected?: string
}): boolean {
  return holdsSelection && closed && selected !== undefined
}

/**
 * The rail's body: every domain the workspace holds, and under the checked ones, their
 * schema hierarchy. The checkbox says what the canvas composes, the name says which domain
 * the studio is about, and the eye puts one away without taking it off the canvas.
 */
export function WorkspaceDomainTree({
  domains,
  onToggleHidden,
}: {
  /** Prepared projections — the checked domains, keyed by id below. */
  domains: WorkspaceDomainProjection[]
  /** Per-member visibility inside one domain (a class or an edge), not the domain itself. */
  onToggleHidden: (domainId: string, ref: string) => void
}) {
  const { data: workspace } = useWorkspace()
  const activeDomainId = useUI((state) => state.domainId)
  const selected = useUI((state) => state.selectedClass)
  const selectionDomainId = useUI((state) => state.selectionDomainId)
  const collapsedByDomain = useSchemaWorkspace((state) => state.collapsedModules)
  const toggleModule = useSchemaWorkspace((state) => state.toggleModule)
  const canvas = useCanvasDomains()
  // Explicit chevron presses only. A domain with no entry here follows the default below:
  // open when it is the one you are working in, closed when it is not — so the rail reads
  // as the list of domains it is, instead of one hierarchy with the others buried under it.
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({})
  const prepared = new Map(domains.map((domain) => [domain.input.summary.id, domain]))

  // Picking a row says what you are looking at. It does NOT make that domain active:
  // which domain the agent, the comments and Core/Process are about is its own decision,
  // taken on the row's name — with the confirmation that spells out what it changes.
  const select = (domainId: string, ref: string) => useUI.getState().selectClass(ref, domainId)

  const toggleExpanded = (domainId: string, expanded: boolean) =>
    setExpandedDomains((current) => ({ ...current, [domainId]: !expanded }))

  return (
    <div data-testid="workspace-domain-tree">
      {(workspace ?? []).map((summary) => {
        const domainId = summary.id
        const domain = prepared.get(domainId)
        const active = activeDomainId === domainId
        const checked = canvas.selected.has(domainId)
        const hidden = canvas.hidden.has(domainId)
        const closed = !(expandedDomains[domainId] ?? active)
        const controls: ModuleTreeControls | null = domain
          ? {
              domainId,
              collapsedModules: collapsedByDomain[domainId] ?? [],
              hidden: domain.input.visibility.hidden,
              toggleModule: (path) => toggleModule(domainId, path),
              toggleHidden: (ref) => onToggleHidden(domainId, ref),
            }
          : null

        return (
          <section key={domainId} className="border-b border-border last:border-b-0">
            <DomainRow
              origin={summary.origin}
              active={active}
              hidden={hidden}
              checked={checked}
              lockedOnCanvas={checked && canvas.selected.size === 1}
              onActivate={() => canvas.requestActivate(domainId, summary.origin)}
              onToggleChecked={() => canvas.toggleOnCanvas(domainId)}
              {...(checked
                ? {
                    expanded: !closed,
                    onToggleExpanded: () => toggleExpanded(domainId, !closed),
                    onToggleHidden: () => canvas.toggleHidden(domainId),
                  }
                : {})}
              showSelectionIndicator={shouldShowDomainSelectionIndicator({
                holdsSelection: selectionDomainId === domainId,
                closed,
                selected,
              })}
            />
            {checked &&
              !closed &&
              controls &&
              domain && (
                // A put-away domain keeps its hierarchy — it is still where you select and
                // hide things — but the whole block dims with the row that owns it.
                <div className={cn('border-t border-border bg-muted/40', hidden && 'opacity-50')}>
                  <ModuleTree
                    root={buildModuleTree(domain.input.bundle)}
                    selected={selectionDomainId === domainId ? selected : undefined}
                    onSelect={(ref) => select(domainId, ref)}
                    controls={controls}
                  />
                </div>
              )}
          </section>
        )
      })}
    </div>
  )
}
