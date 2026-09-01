import { useCallback, useEffect, useMemo } from 'react'

import { useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'

import { selectionForActiveDomain, useSchemaWorkspace } from './store'

/**
 * The canvas always holds the active domain, and only domains the workspace still has.
 * That invariant used to ride along in the header's domain selector; the selector is gone
 * (the rail owns the choice now), so it lives with the selection itself.
 */
export function useCanvasSelectionSync(): void {
  const { data: domains } = useWorkspace()
  const domainId = useUI((state) => state.domainId)
  const selectedDomainIds = useSchemaWorkspace((state) => state.selectedDomainIds)
  const replaceDomains = useSchemaWorkspace((state) => state.replaceDomains)

  useEffect(() => {
    if (!domainId || !domains) return
    const valid = new Set(domains.map((domain) => domain.id))
    const next = selectedDomainIds.filter((id) => valid.has(id))
    if (!next.includes(domainId)) next.unshift(domainId)
    if (
      next.length !== selectedDomainIds.length ||
      next.some((id, index) => id !== selectedDomainIds[index])
    ) {
      replaceDomains(next)
    }
  }, [domainId, domains, replaceDomains, selectedDomainIds])
}

export interface CanvasDomainControls {
  /** The domains the canvas composes — the active one is always among them. */
  selected: Set<string>
  /** The domains put away: still in the rail, no frame on the canvas. */
  hidden: Set<string>
  /** Make a domain the active one; it joins the canvas if it was not on it. */
  activate: (id: string) => void
  /** What a click on a domain's name does: confirm first, unless that was turned off. */
  requestActivate: (id: string, origin: string) => void
  /** Put a domain on the canvas, or take it off. The last one cannot leave. */
  toggleOnCanvas: (id: string) => void
  /** Hide / show a domain's frame without taking it off the canvas. */
  toggleHidden: (id: string) => void
}

/** Everything the rail does to the canvas composition, in one place. */
export function useCanvasDomains(): CanvasDomainControls {
  const domainId = useUI((state) => state.domainId)
  const setDomain = useUI((state) => state.setDomain)
  const requestDomainSwitch = useUI((state) => state.requestDomainSwitch)
  const selectedDomainIds = useSchemaWorkspace((state) => state.selectedDomainIds)
  const hiddenDomainIds = useSchemaWorkspace((state) => state.hiddenDomainIds)
  const replaceDomains = useSchemaWorkspace((state) => state.replaceDomains)
  const toggleDomain = useSchemaWorkspace((state) => state.toggleDomain)
  const toggleDomainHidden = useSchemaWorkspace((state) => state.toggleDomainHidden)

  const selected = useMemo(() => {
    const ids = new Set(selectedDomainIds)
    if (domainId) ids.add(domainId)
    return ids
  }, [domainId, selectedDomainIds])
  const hidden = useMemo(() => new Set(hiddenDomainIds), [hiddenDomainIds])

  const activate = useCallback(
    (id: string) => {
      replaceDomains(domainId ? selectionForActiveDomain([...selected], domainId, id) : [id])
      // Choosing to work in a domain is choosing to see it: leaving it put away would
      // answer the click with a canvas that has nothing of the domain it is now about.
      if (hidden.has(id)) toggleDomainHidden(id)
      setDomain(id)
    },
    [domainId, hidden, replaceDomains, selected, setDomain, toggleDomainHidden],
  )

  /**
   * Unchecking the ACTIVE domain used to be a dead click; it hands the active role to
   * another domain on the canvas and removes this one — the only reading of that gesture
   * that means anything. The last remaining domain is checked and not yours to uncheck.
   */
  const toggleOnCanvas = useCallback(
    (id: string) => {
      if (!domainId) {
        setDomain(id)
        return
      }
      if (!selected.has(id)) {
        toggleDomain(id, domainId)
        return
      }
      if (id !== domainId) {
        toggleDomain(id, domainId)
        return
      }
      const remaining = [...selected].filter((candidate) => candidate !== id)
      if (remaining.length === 0) return
      replaceDomains(remaining)
      setDomain(remaining[0])
    },
    [domainId, replaceDomains, selected, setDomain, toggleDomain],
  )

  /**
   * Which domain you work in is the one choice on this rail that reaches outside the
   * canvas — the agent conversation, the comment threads, Core and Process all move with
   * it. It is confirmed rather than taken on a click, until the reader says not to ask.
   */
  const requestActivate = useCallback(
    (id: string, origin: string) => {
      if (id === domainId) return
      if (!useUI.getState().confirmDomainSwitch) {
        activate(id)
        return
      }
      requestDomainSwitch({ id, origin })
    },
    [activate, domainId, requestDomainSwitch],
  )

  return {
    selected,
    hidden,
    activate,
    requestActivate,
    toggleOnCanvas,
    toggleHidden: toggleDomainHidden,
  }
}
