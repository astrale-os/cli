import { useCallback, useEffect, useMemo } from 'react'

import { useWorkspace } from '@/lib/hooks'

import { useSchemaWorkspace } from './store'

/**
 * The canvas only ever holds domains the workspace still has. On first open it shows the
 * first discovered domain; after that an empty canvas is a deliberate state we preserve.
 */
export function useCanvasSelectionSync(enabled = true): void {
  const { data: domains } = useWorkspace()
  const replaceDomains = useSchemaWorkspace((state) => state.replaceDomains)

  useEffect(() => {
    if (!enabled || !domains) return
    const { visibleDomainIds, initialized } = useSchemaWorkspace.getState()
    const valid = new Set(domains.map((domain) => domain.id))
    const next = visibleDomainIds.filter((id) => valid.has(id))
    if (!initialized && domains.length > 0 && next.length === 0) {
      replaceDomains([domains[0]!.id])
      return
    }
    if (next.length !== visibleDomainIds.length) replaceDomains(next)
  }, [domains, enabled, replaceDomains])
}

export interface CanvasDomainControls {
  /** The domains the canvas draws. */
  visible: Set<string>
  /** Put a domain on the canvas, or take it off. */
  toggleOnCanvas: (id: string) => void
}

/** Everything the rail does to the canvas composition, in one place. */
export function useCanvasDomains(): CanvasDomainControls {
  const visibleDomainIds = useSchemaWorkspace((state) => state.visibleDomainIds)
  const toggleDomain = useSchemaWorkspace((state) => state.toggleDomain)

  const visible = useMemo(() => new Set(visibleDomainIds), [visibleDomainIds])

  /**
   * The canvas composition is now the WHOLE meaning of this: a domain is drawn or it is
   * not. Nothing else changes: the agent and comments always cover the whole workspace.
   */
  const toggleOnCanvas = useCallback((id: string) => toggleDomain(id), [toggleDomain])

  return { visible, toggleOnCanvas }
}
