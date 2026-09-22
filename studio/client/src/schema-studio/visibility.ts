import type { VisibilityState } from '@shared/types'

import { domainAnchorRef } from '@/lib/targets'

import { memberRefKey } from './modules'

export type Hidden = Record<string, true>

export const VISIBILITY_DEFAULT: VisibilityState = {
  hidden: {},
  showInheritedEdges: true,
}

export const classRef = (name: string): string => memberRefKey('class', name)
export const edgeRef = (name: string): string => memberRefKey('edge', name)
/** Hiding a domain and commenting on one name the SAME thing, so they spell it once. */
export const domainRef = domainAnchorRef

export function isHidden(ref: string, hidden: Hidden): boolean {
  return hidden[ref] === true
}

export function toggleVisibilityRef(state: VisibilityState, ref: string): VisibilityState {
  const hidden = { ...state.hidden }
  if (hidden[ref]) delete hidden[ref]
  else hidden[ref] = true
  return { ...state, hidden }
}

export function classNodeVisible(name: string, hidden: Hidden): boolean {
  return !isHidden(classRef(name), hidden)
}

export function edgeVisible(
  edge: { edgeName: string; aClass: string; bClass: string },
  hidden: Hidden,
): boolean {
  return (
    !isHidden(edgeRef(edge.edgeName), hidden) &&
    !isHidden(classRef(edge.aClass), hidden) &&
    !isHidden(classRef(edge.bClass), hidden)
  )
}
