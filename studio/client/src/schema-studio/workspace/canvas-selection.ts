import { useCallback, useEffect, useMemo } from 'react'

import { useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'

import { selectionForActiveDomain, useSchemaWorkspace } from './store'

/**
 * The canvas only ever holds domains the workspace still has — and, the very first time
 * the studio is opened, the domain you work in, so it does not open on nothing.
 *
 * After that the selection is yours: an empty canvas is a state you can reach and keep,
 * and the active domain is NOT forced back onto it. Which domain the agent, the comments,
 * Core and Process are about is a different question from what is drawn.
 */
export function useCanvasSelectionSync(): void {
  const { data: domains } = useWorkspace()
  const domainId = useUI((state) => state.domainId)
  const selectedDomainIds = useSchemaWorkspace((state) => state.selectedDomainIds)
  const initialized = useSchemaWorkspace((state) => state.initialized)
  const replaceDomains = useSchemaWorkspace((state) => state.replaceDomains)

  useEffect(() => {
    if (!domains) return
    const valid = new Set(domains.map((domain) => domain.id))
    const next = selectedDomainIds.filter((id) => valid.has(id))
    if (!initialized && domainId && next.length === 0) {
      replaceDomains([domainId])
      return
    }
    if (next.length !== selectedDomainIds.length) replaceDomains(next)
  }, [domainId, domains, initialized, replaceDomains, selectedDomainIds])
}

export interface CanvasDomainControls {
  /** The domains the canvas draws. Not necessarily the one you are working in. */
  selected: Set<string>
  /** Make a domain the active one; it joins the canvas if it was not on it. */
  activate: (id: string) => void
  /** What a click on a domain's name does: confirm first, unless that was turned off. */
  requestActivate: (id: string, origin: string) => void
  /** Put a domain on the canvas, or take it off. */
  toggleOnCanvas: (id: string) => void
}

/** Everything the rail does to the canvas composition, in one place. */
export function useCanvasDomains(): CanvasDomainControls {
  const domainId = useUI((state) => state.domainId)
  const setDomain = useUI((state) => state.setDomain)
  const requestDomainSwitch = useUI((state) => state.requestDomainSwitch)
  const selectedDomainIds = useSchemaWorkspace((state) => state.selectedDomainIds)
  const replaceDomains = useSchemaWorkspace((state) => state.replaceDomains)
  const toggleDomain = useSchemaWorkspace((state) => state.toggleDomain)

  const selected = useMemo(() => new Set(selectedDomainIds), [selectedDomainIds])

  const activate = useCallback(
    (id: string) => {
      // Choosing to work in a domain is choosing to see it: activating one that is off
      // the canvas would answer the click with a canvas that has nothing of the domain
      // it is now about.
      replaceDomains(selectionForActiveDomain(selectedDomainIds, id))
      setDomain(id)
    },
    [replaceDomains, selectedDomainIds, setDomain],
  )

  /**
   * The canvas composition is now the WHOLE meaning of this: a domain is drawn or it is
   * not. Nothing is transferred, nothing is locked — taking the active domain off the
   * canvas leaves it active (its chat, its threads and Core are untouched), and taking
   * the last one off leaves an empty canvas, which is a thing a reader may want.
   */
  const toggleOnCanvas = useCallback((id: string) => toggleDomain(id), [toggleDomain])

  /**
   * Which domain you work in is the one choice on this rail that reaches outside the
   * canvas — the agent conversation, the comment threads, Core and Process all move with
   * it. It is confirmed rather than taken on a click, until the reader says not to ask.
   *
   * Clicking the domain you are ALREADY working in changes none of that, so when it is
   * off the canvas the click simply puts it back — no dialog for a canvas gesture.
   */
  const requestActivate = useCallback(
    (id: string, origin: string) => {
      if (id === domainId) {
        if (!selected.has(id)) toggleDomain(id)
        return
      }
      if (!useUI.getState().confirmDomainSwitch) {
        activate(id)
        return
      }
      requestDomainSwitch({ id, origin })
    },
    [activate, domainId, requestDomainSwitch, selected, toggleDomain],
  )

  return { selected, activate, requestActivate, toggleOnCanvas }
}
