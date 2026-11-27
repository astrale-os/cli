import { describe, expect, test } from 'bun:test'

import type { Scene, SceneLink } from '../scene/types'

import { arrange } from '../scene/arrange'
import { neighbourhood } from '../scene/focus'
import { atRest, faintLines, lineEmphasis, type LineFocus, nameDrawn } from './emphasis'
import { closedLabels, openLabels, type PlacedLabel } from './labels'
import { boxModels, gridPlacement } from './layout'
import { estimateText } from './metrics'

const card = (id: string) => ({ id, kind: 'class', shape: 'card' as const, label: id })
const link = (id: string, from: string, to: string, extra: Partial<SceneLink> = {}) => ({
  id,
  kind: 'relationship',
  label: `${id}_name`,
  from: { nodes: [from], count: '0..1' },
  to: { nodes: [to], count: '0..*' },
  directed: true,
  ...extra,
})

/** A and B joined twice, B and C once, and A to a hub every card reaches, drawn faint. */
const scene: Scene = {
  key: 'names',
  nodes: [card('A'), card('B'), card('C'), card('Hub')],
  links: [
    link('ab', 'A', 'B'),
    link('ab2', 'A', 'B'),
    link('bc', 'B', 'C'),
    link('a_hub', 'A', 'Hub', { ambient: true }),
  ],
  groups: [],
  folded: [],
}
const arrangement = arrange(scene, { collapsed: new Set() })
const placement = gridPlacement(
  arrangement,
  boxModels(arrangement, 'compact', estimateText),
  'compact',
)
const faint = faintLines(scene, arrangement)
const trunkOf = (id: string) => arrangement.linkPlace.get(id)!.trunk!
const focusOn = (id: string): LineFocus => ({
  lit: neighbourhood(scene, arrangement, id),
  asLit: new Set(),
  faint,
})

/** Every name the canvas would place under `focus`: closed trunks' and open trunks' alike. */
function namesUnder(focus: LineFocus): PlacedLabel[] {
  const closed = closedLabels(scene, arrangement, placement, estimateText)
  const result: PlacedLabel[] = []
  for (const trunk of arrangement.trunks) {
    const label = focus.lit?.trunks.has(trunk.id) ? undefined : closed.get(trunk.id)
    if (label && nameDrawn(trunk.id, focus)) result.push(label)
  }
  for (const trunk of arrangement.trunks) {
    if (!focus.lit?.trunks.has(trunk.id)) continue
    result.push(
      ...openLabels(scene, arrangement, trunk, placement, result, estimateText, true, true, (id) =>
        nameDrawn(id, focus),
      ),
    )
  }
  return result
}

describe('a line and its name read by one rule', () => {
  test('a line is lit by the focus or as if lit, dimmed beside a focus, else at rest', () => {
    const rest = atRest(faint)
    expect(lineEmphasis('ab', rest)).toBe('rest')
    const onA = focusOn('A')
    expect(lineEmphasis('ab', onA)).toBe('lit')
    expect(lineEmphasis(trunkOf('ab'), onA)).toBe('lit')
    expect(lineEmphasis('bc', onA)).toBe('dim')
    expect(lineEmphasis(trunkOf('bc'), onA)).toBe('dim')
    expect(lineEmphasis('bc', { ...onA, asLit: new Set(['bc']) })).toBe('lit')
  })

  test('a name is drawn on a line that reads in full: never dimmed, never faint until lit', () => {
    expect(faint).toEqual(new Set(['a_hub', trunkOf('a_hub')]))
    const rest = atRest(faint)
    expect(nameDrawn('bc', rest)).toBe(true)
    expect(nameDrawn('a_hub', rest)).toBe(false)
    expect(nameDrawn(trunkOf('a_hub'), rest)).toBe(false)
    const onA = focusOn('A')
    expect(nameDrawn('a_hub', onA)).toBe(true)
    expect(nameDrawn('bc', onA)).toBe(false)
    expect(nameDrawn(trunkOf('bc'), onA)).toBe(false)
  })

  test('no dimmed or faint line has a name placed, and a lit one keeps its own', () => {
    const named = (labels: readonly PlacedLabel[]) =>
      [...new Set(labels.filter((label) => !label.end).map((label) => label.text))].sort()

    // At rest: every name but the hub's faint line.
    expect(named(namesUnder(atRest(faint)))).toEqual(['2 relationships', 'bc_name'])

    // On A: its lines, the hub's among them, and not the dimmed B–C.
    const onA = namesUnder(focusOn('A'))
    expect(named(onA)).toEqual(['a_hub_name', 'ab2_name', 'ab_name'])
    expect(onA.some((label) => label.id === 'bc' || label.id === trunkOf('bc'))).toBe(false)

    // One link selected in a trunk of two: its sibling is dimmed, name and end counts alike.
    const onAb = namesUnder(focusOn('ab'))
    expect(onAb.map((label) => label.id)).not.toContain('ab2')
    expect(named(onAb)).toEqual(['ab_name'])
    expect(onAb.filter((label) => label.end).map((label) => label.id)).toEqual(['ab', 'ab'])
  })
})
