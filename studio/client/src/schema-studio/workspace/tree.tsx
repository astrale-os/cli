import { useState } from 'react'

import { useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'

import type { WorkspaceDomainProjection } from './projection'

import { DomainRow } from '../domains-rail'
import { buildModuleTree } from '../modules'
import { ModuleTree, type ModuleTreeControls } from '../tree'
import { useCanvasDomains } from './canvas-selection'
import { useSchemaWorkspace } from './store'

/**
 * One step of the rail's hierarchy, in pixels: enough for a module row's name to clear the
 * domain name above it, which is what makes the two levels read as one tree now that no
 * rule separates them.
 */
const MODULE_INDENT = 18

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
 * schema hierarchy. One control per question: the checkbox says what the canvas draws,
 * the name says which domain the studio is about.
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
          <section key={domainId}>
            <DomainRow
              origin={summary.origin}
              active={active}
              checked={checked}
              onActivate={() => canvas.requestActivate(domainId, summary.origin)}
              onToggleChecked={() => canvas.toggleOnCanvas(domainId)}
              {...(checked
                ? {
                    expanded: !closed,
                    onToggleExpanded: () => toggleExpanded(domainId, !closed),
                  }
                : {})}
              showSelectionIndicator={shouldShowDomainSelectionIndicator({
                holdsSelection: selectionDomainId === domainId,
                closed,
                selected,
              })}
            />
            {/* No rule and no tint between a domain and its modules: the rail is ONE tree,
                and the hierarchy is carried by the indent alone. */}
            {checked && !closed && controls && domain && (
              <ModuleTree
                root={buildModuleTree(domain.input.bundle)}
                indent={MODULE_INDENT}
                selected={selectionDomainId === domainId ? selected : undefined}
                onSelect={(ref) => select(domainId, ref)}
                controls={controls}
              />
            )}
          </section>
        )
      })}
    </div>
  )
}
