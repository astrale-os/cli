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
  /** the selection belongs to THIS domain */
  holdsSelection: boolean
  closed: boolean
  selected?: string
}): boolean {
  return holdsSelection && closed && selected !== undefined
}

/**
 * The rail's body: every domain the workspace holds and, under visible unfolded ones,
 * their schema hierarchy. The eye is deliberately the sole canvas visibility control.
 */
export function WorkspaceDomainTree({
  domains,
  onToggleHidden,
}: {
  /** Prepared projections — the visible domains, keyed by id below. */
  domains: WorkspaceDomainProjection[]
  /** Per-member visibility inside one domain (a class or an edge), not the domain itself. */
  onToggleHidden: (domainId: string, ref: string) => void
}) {
  const { data: workspace } = useWorkspace()
  const selected = useUI((state) => state.selectedClass)
  const selectionDomainId = useUI((state) => state.selectionDomainId)
  const collapsedByDomain = useSchemaWorkspace((state) => state.collapsedModules)
  const toggleModule = useSchemaWorkspace((state) => state.toggleModule)
  const expandedDomainIds = useSchemaWorkspace((state) => state.expandedDomainIds)
  const toggleDomainExpanded = useSchemaWorkspace((state) => state.toggleDomainExpanded)
  const canvas = useCanvasDomains()
  const expanded = new Set(expandedDomainIds)
  const prepared = new Map(domains.map((domain) => [domain.input.summary.id, domain]))

  const select = (domainId: string, ref: string) => useUI.getState().selectClass(ref, domainId)

  return (
    <div data-testid="workspace-domain-tree">
      {(workspace ?? []).map((summary) => {
        const domainId = summary.id
        const domain = prepared.get(domainId)
        const visible = canvas.visible.has(domainId)
        const closed = !visible || !expanded.has(domainId)
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
              domainId={domainId}
              visible={visible}
              onToggleVisible={() => canvas.toggleOnCanvas(domainId)}
              {...(visible
                ? {
                    expanded: !closed,
                    onToggleExpanded: () => toggleDomainExpanded(domainId),
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
            {visible && !closed && controls && domain && (
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
