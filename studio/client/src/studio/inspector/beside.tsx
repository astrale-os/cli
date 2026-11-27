/**
 * The page of what a Domain drawn beside the open one declares, on the open Domain's canvas: that
 * Domain's own page — read against its bundle, named in its refs, its comments filed under it —
 * headed by its name and a way to open it in that Domain.
 *
 * What the page names opens on this canvas when the canvas draws it; anything else, and every
 * other question about it (a lens switch), opens in the Domain that names it.
 */

import type { StudioSchemaBundle } from '@shared/contracts/schema'

import { ArrowUpRight } from 'lucide-react'
import { useMemo } from 'react'

import { useUI } from '@/lib/store'

import type { LensId } from '../lenses/keys'
import type { Scene } from '../scene/types'

import { canvasIdOf } from '../lenses/composition'
import { Inspector } from './inspector'
import { type InspectorPlace, InspectorPlaceContext, openTarget } from './parts'

/** Opens `target` in the Domain `domainId`, under `lens` when given. */
function openThere(target: string, domainId: string, lens?: LensId) {
  const ui = useUI.getState()
  ui.openDomain(domainId)
  if (lens) ui.setLens(lens)
  openTarget(target, domainId)
}

export function BesidePage({
  bundle,
  anchor,
  label,
  canvas,
}: {
  /** the bundle of the Domain drawn beside the open one */
  bundle: StudioSchemaBundle
  /** the selection as that Domain names it */
  anchor: string
  /** that Domain's name */
  label: string
  /** the open Domain's canvas: its Domain, its name and what it draws */
  canvas: { domainId: string; origin: string; label: string; scene: Scene }
}) {
  const place = useMemo<InspectorPlace>(() => {
    const drawn = (id: string) =>
      canvas.scene.nodes.some((node) => node.id === id) ||
      canvas.scene.links.some((link) => link.id === id)
    return {
      open: (target, domainId) => {
        const from = domainId === canvas.domainId ? canvas.origin : bundle.ir?.domain
        const id =
          domainId === bundle.domainId || domainId === canvas.domainId
            ? from && canvasIdOf(target, from, canvas.origin)
            : undefined
        if (id && drawn(id)) {
          const ui = useUI.getState()
          ui.selectClass(id, canvas.domainId)
          ui.revealOnCanvas(id)
        } else openThere(target, domainId)
      },
      ask: (lens) => openThere(anchor, bundle.domainId, lens),
    }
  }, [anchor, bundle, canvas])
  return (
    <InspectorPlaceContext.Provider value={place}>
      <Inspector
        bundle={bundle}
        selected={anchor}
        beside={
          <div
            data-inspector-beside={bundle.domainId}
            className="mb-4 flex items-center gap-2 pr-8 text-[12px] text-muted-foreground"
          >
            <span className="min-w-0 flex-1 truncate">
              From <span className="font-medium text-foreground">{label}</span>, drawn beside{' '}
              {canvas.label}
            </span>
            <button
              type="button"
              data-open-beside={bundle.domainId}
              onClick={() => openThere(anchor, bundle.domainId)}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[12px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              Open in {label}
              <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
            </button>
          </div>
        }
      />
    </InspectorPlaceContext.Provider>
  )
}
