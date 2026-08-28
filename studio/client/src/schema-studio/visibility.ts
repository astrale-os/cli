import type { VisibilityState } from '@shared/types'

import { memberRefKey } from './modules'

export type Hidden = Record<string, true>

export const VISIBILITY_DEFAULT: VisibilityState = {
  hidden: {},
  showInheritedEdges: true,
}

export const classRef = (name: string): string => memberRefKey('class', name)
export const edgeRef = (name: string): string => memberRefKey('edge', name)
export const domainRef = (origin: string): string => `domain.${origin}`

export function isHidden(ref: string, hidden: Hidden): boolean {
  return hidden[ref] === true
}

export function toggleVisibilityRef(state: VisibilityState, ref: string): VisibilityState {
  const hidden = { ...state.hidden }
  if (hidden[ref]) delete hidden[ref]
  else hidden[ref] = true
  return { ...state, hidden }
}

export function visibilityEqual(left: VisibilityState, right: VisibilityState): boolean {
  if (left.showInheritedEdges !== right.showInheritedEdges) return false
  const keys = Object.keys(left.hidden)
  return keys.length === Object.keys(right.hidden).length && keys.every((key) => right.hidden[key])
}

export function classNodeVisible(name: string, hidden: Hidden): boolean {
  return !isHidden(classRef(name), hidden)
}

export function domainVisible(origin: string, hidden: Hidden): boolean {
  return !isHidden(domainRef(origin), hidden)
}

export function edgeVisible(
  edge: { edgeName: string; aClass: string; bClass: string },
  hidden: Hidden,
  _showInheritedEdges: boolean,
): boolean {
  return (
    !isHidden(edgeRef(edge.edgeName), hidden) &&
    !isHidden(classRef(edge.aClass), hidden) &&
    !isHidden(classRef(edge.bClass), hidden)
  )
}
