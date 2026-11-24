import type { SelectedNode } from '@astrale-os/shell'
import type { FinderChoice, FinderPlace } from '@astrale-os/ui/finder'

import { NODE_NAME_MAXIMUM_LENGTH, SelectionRefusedError } from '@astrale-os/shell'

/**
 * What the `astrale view` node selector adds to the Finder: the Nodes a View receives, the words for
 * the Nodes the Shell refuses, and the place the next request opens at.
 */

/** A chosen Node as a View receives it; a name longer than a View may carry is shortened. */
export function selectedNode(choice: FinderChoice): SelectedNode {
  const name =
    choice.name.length > NODE_NAME_MAXIMUM_LENGTH
      ? `${choice.name.slice(0, NODE_NAME_MAXIMUM_LENGTH - 1)}…`
      : choice.name
  return { id: choice.id, class: choice.class as SelectedNode['class'], name }
}

/** The Nodes the Shell refused, named; nothing for any other failure. */
export function refusalMessage(error: unknown): string | undefined {
  if (!(error instanceof SelectionRefusedError) || error.nodes.length === 0) return undefined
  const names = new Intl.ListFormat('en', { type: 'conjunction' }).format(
    error.nodes.map((node) => node.name),
  )
  return `${names} can no longer be selected`
}

const PLACE_KEY_PREFIX = 'astrale.view.finder-place:'

/** The part of the browser's `localStorage` the place needs. */
export interface PlaceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface RememberedPlace {
  /** The identity the View ran as. */
  readonly identity: string
  readonly place: FinderPlace
}

/**
 * Where the last request stood on this instance, kept in this browser: the Domain and the Classes,
 * never a Node. The Finder checks it against what the caller may read and what the request accepts.
 * Only the identity that left it gets it back.
 */
export function rememberedPlaceOf(
  storage: PlaceStorage | undefined,
  instance: string,
  identity: string,
): FinderPlace | undefined {
  try {
    const remembered = parseRememberedPlace(storage?.getItem(PLACE_KEY_PREFIX + instance) ?? null)
    return remembered?.identity === identity ? remembered.place : undefined
  } catch {
    return undefined
  }
}

export function rememberPlace(
  storage: PlaceStorage | undefined,
  instance: string,
  identity: string,
  place: FinderPlace,
): void {
  try {
    const text = JSON.stringify({ identity, place } satisfies RememberedPlace)
    if (storage?.getItem(PLACE_KEY_PREFIX + instance) !== text) {
      storage?.setItem(PLACE_KEY_PREFIX + instance, text)
    }
  } catch {
    // Storage full or denied: the next request opens at the start.
  }
}

export function parseRememberedPlace(text: string | null): RememberedPlace | null {
  if (text === null) return null
  try {
    const raw = JSON.parse(text) as { identity?: unknown; place?: unknown } | null
    if (typeof raw?.identity !== 'string') return null
    const place = raw.place as { domain?: unknown; classes?: unknown } | null | undefined
    if (typeof place !== 'object' || place === null) return null
    if (place.domain !== undefined && typeof place.domain !== 'string') return null
    if (
      place.classes !== undefined &&
      !(Array.isArray(place.classes) && place.classes.every((key) => typeof key === 'string'))
    ) {
      return null
    }
    return {
      identity: raw.identity,
      place: {
        ...(place.domain === undefined ? {} : { domain: place.domain }),
        ...(place.classes === undefined ? {} : { classes: place.classes as string[] }),
      },
    }
  } catch {
    return null
  }
}
