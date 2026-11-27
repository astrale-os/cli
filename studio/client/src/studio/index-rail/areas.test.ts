import { describe, expect, test } from 'bun:test'

import type { IndexRow } from './model'

import {
  HOME,
  homeBundle,
  PEER,
  peerBundle,
  peerClass,
  whole,
} from '../lenses/__tests__/several-domains'
import { composeStructure, NO_COMPOSITION, projectStructure } from '../lenses/structure'
import { indexRows } from './model'

const ALL = { query: '', hidden: new Set<string>() }
const composed = () => composeStructure(homeBundle(), {}, whole(peerBundle()))

/** Each area's id, and the ids of the rows listed under it, up to the next area. */
function byArea(rows: readonly IndexRow[]) {
  const listed: [string, string[]][] = []
  for (const row of rows)
    if (row.type === 'area') listed.push([row.id, []])
    else listed.at(-1)?.[1].push(row.id)
  return listed
}

describe('the Index of a canvas of one Domain', () => {
  test('lists no area: the Domain’s modules and Classes, as before any other Domain is drawn whole', () => {
    const rows = indexRows(projectStructure(homeBundle(), {}), ALL, new Set())
    expect(rows.some((row) => row.type === 'area')).toBe(false)
    expect(rows).toEqual(
      indexRows(composeStructure(homeBundle(), {}, NO_COMPOSITION), ALL, new Set()),
    )
  })
})

describe('the Index of a canvas of several Domains', () => {
  test('lists one top group per Domain, the open one first, each named and versioned', () => {
    const rows = indexRows(composed(), ALL, new Set())
    const areas = rows.filter((row) => row.type === 'area')
    expect(areas).toEqual([
      expect.objectContaining({
        id: `area.${HOME}`,
        label: 'Home',
        version: '0.4.0',
        home: true,
        origin: HOME,
        domainId: 'home-id',
        collapsed: false,
      }),
      expect.objectContaining({
        id: `area.${PEER}`,
        label: 'peer-id',
        version: '1.0.0',
        home: false,
        origin: PEER,
        domainId: 'peer-id',
        collapsed: false,
      }),
    ])
    expect(rows[0]?.type).toBe('area')
  })

  test('each Domain lists its own modules and Classes, its modules under it', () => {
    const scene = composed()
    const rows = indexRows(scene, ALL, new Set())
    const listed = new Map(byArea(rows))
    const ofArea = (id: string) => scene.nodes.find((node) => node.id === id)?.area
    for (const [area, ids] of listed)
      for (const id of ids) {
        const row = rows.find((each) => each.id === id)!
        if (row.type === 'group') expect(row.area).toBe(area)
        if (row.type === 'item' && row.kind !== 'relationship') expect(ofArea(id)).toBe(area)
      }
    expect(listed.get(`area.${HOME}`)).toContain('class.Member')
    expect(listed.get(`area.${PEER}`)).toContain(peerClass('Ticket'))
    expect(listed.get(`area.${PEER}`)).toContain(peerClass('Label'))
    // the counts are what each lists
    for (const row of rows.filter((each) => each.type === 'area'))
      expect(row.type === 'area' && row.count).toBe(
        rows.filter((each) => each.type === 'item' && each.area === row.id).length,
      )
  })

  test('a Domain shut lists its name alone; a query lists its matches anyway', () => {
    const shut = new Set([`area.${PEER}`])
    const rows = indexRows(composed(), ALL, shut)
    const peer = rows.findIndex((row) => row.id === `area.${PEER}`)
    expect(rows[peer]).toMatchObject({ type: 'area', collapsed: true })
    expect(rows.slice(peer + 1)).toEqual([])
    const found = indexRows(composed(), { query: 'label', hidden: new Set() }, shut)
    expect(found.some((row) => row.id === peerClass('Label'))).toBe(true)
  })

  test('a Domain none of whose parts match is not listed', () => {
    const rows = indexRows(composed(), { query: 'member_has', hidden: new Set() }, new Set())
    expect(rows.filter((row) => row.type === 'area').map((row) => row.id)).toEqual([`area.${HOME}`])
  })
})
