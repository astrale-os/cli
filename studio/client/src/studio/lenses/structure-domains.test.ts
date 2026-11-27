import { describe, expect, test } from 'bun:test'

import type { Scene } from '../scene/types'

import { edgeClass, nodeClass } from '../../schema-studio/__tests__/fixture'
import {
  domainBundle,
  end,
  HOME,
  homeBundle,
  PEER,
  peerBundle,
  peerClass,
  SHELL,
  shellClass,
  THIRD,
  thirdBundle,
  whole,
} from './__tests__/several-domains'
import {
  areaHues,
  composeStructure,
  NO_COMPOSITION,
  projectStructure,
  type StructureComposition,
} from './structure'

const node = (scene: Scene, id: string) => scene.nodes.find((candidate) => candidate.id === id)
const link = (scene: Scene, id: string) => scene.links.find((candidate) => candidate.id === id)
const ends = (scene: Scene, id: string) => {
  const found = link(scene, id)!
  return [found.from.nodes, found.to.nodes]
}

/** No two nodes, groups, links or areas of the Scene share an id. */
function expectUniqueIds(scene: Scene) {
  for (const items of [scene.nodes, scene.groups, scene.links, scene.areas ?? []]) {
    const ids = items.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  }
}

describe('Structure with every other Domain reached', () => {
  test('is the open Domain alone: no areas, its reached Classes in their Domains’ frames', () => {
    const scene = projectStructure(homeBundle(), {})
    expect(scene).toEqual(composeStructure(homeBundle(), {}, NO_COMPOSITION))
    expect(scene.areas).toBeUndefined()
    expect(scene.key).toBe(`structure:home-id:home-id-render::dependencies`)
    expect(node(scene, peerClass('Ticket'))).toMatchObject({
      kind: 'imported class',
      tone: 'muted',
      group: `domain.${PEER}`,
    })
    expect(scene.nodes.every((each) => each.area === undefined)).toBe(true)
  })

  test('a Domain whose whole Schema is not read yet is drawn as reached meanwhile', () => {
    const pending: StructureComposition = { shares: { [PEER]: 'whole' }, whole: [] }
    expect(composeStructure(homeBundle(), {}, pending)).toEqual(projectStructure(homeBundle(), {}))
  })

  test('a whole Domain is never made up from the Classes the open Domain imports', () => {
    // Shell's Identity is imported, resolved even; without Shell's own Schema it stays reached.
    const scene = composeStructure(homeBundle(), {}, { shares: { [SHELL]: 'whole' }, whole: [] })
    expect(scene.areas).toBeUndefined()
    expect(node(scene, shellClass('Identity'))).toMatchObject({ kind: 'imported class' })
  })
})

describe('Structure with a Domain hidden', () => {
  test('its Classes are not drawn: each end that accepts one lands on its one node', () => {
    const scene = composeStructure(homeBundle(), {}, { shares: { [SHELL]: 'hidden' }, whole: [] })
    expect(node(scene, shellClass('Identity'))).toBeUndefined()
    expect(node(scene, `domain.${SHELL}`)).toMatchObject({ kind: 'domain', label: 'shell' })
    expect(ends(scene, 'class.member_is')).toEqual([['class.Member'], [`domain.${SHELL}`]])
    expect(scene.key).toContain(`hidden=${SHELL}`)
  })
})

describe('Structure with a Domain drawn whole', () => {
  const scene = composeStructure(homeBundle(), {}, whole(peerBundle()))

  test('each Domain is an area: the open one first, named and versioned', () => {
    expect(scene.areas).toEqual([
      {
        id: `area.${HOME}`,
        origin: HOME,
        domainId: 'home-id',
        label: 'Home',
        version: '0.4.0',
        home: true,
        hue: expect.any(Number),
      },
      {
        id: `area.${PEER}`,
        origin: PEER,
        domainId: 'peer-id',
        label: 'peer-id',
        version: '1.0.0',
        hue: expect.any(Number),
      },
    ])
    // two Domains side by side never wear one hue
    expect(scene.areas![0]!.hue).not.toBe(scene.areas![1]!.hue)
    for (const items of [scene.nodes, scene.groups, scene.links])
      expect(items.every((item) => item.area !== undefined)).toBe(true)
  })

  test('the whole Domain is drawn as its own lens draws it, complete, its comments its own', () => {
    expect(node(scene, peerClass('Ticket'))).toMatchObject({
      kind: 'class',
      tone: 'node',
      label: 'Ticket',
      area: `area.${PEER}`,
      group: `module.modules/tickets@${PEER}`,
      anchor: 'class.Ticket',
      anchorDomain: 'peer-id',
    })
    expect(node(scene, peerClass('Ticket'))!.rows).toEqual([
      {
        id: `${peerClass('Ticket')}.property.title`,
        anchor: 'class.Ticket.property.title',
        anchorDomain: 'peer-id',
        label: 'title',
        detail: 'string',
        marks: [],
      },
    ])
    expect(scene.groups.find((group) => group.id === `module.modules/tickets@${PEER}`)).toEqual(
      expect.objectContaining({
        anchor: 'module.modules/tickets',
        anchorDomain: 'peer-id',
        label: 'Tickets',
        area: `area.${PEER}`,
        hue: expect.any(Number),
      }),
    )
    expect(link(scene, peerClass('ticket_has_label'))).toMatchObject({
      anchor: 'edge.ticket_has_label',
      anchorDomain: 'peer-id',
      area: `area.${PEER}`,
    })
    // no reached frame is left for it
    expect(scene.groups.some((group) => group.id === `domain.${PEER}`)).toBe(false)
  })

  test('relationships between the Domains end in each other’s areas, whichever declares them', () => {
    expect(ends(scene, 'class.member_files')).toEqual([['class.Member'], [peerClass('Ticket')]])
    expect(ends(scene, peerClass('ticket_watched_by'))).toEqual([
      [peerClass('Ticket')],
      ['class.Member'],
    ])
    // a card counts every relationship it takes part in, wherever declared
    expect(node(scene, peerClass('Ticket'))!.counts).toContainEqual({
      label: 'relationships',
      value: 5,
    })
  })

  test('a Class both Domains reach is drawn once, by the open Domain', () => {
    expect(scene.nodes.filter((each) => each.id === shellClass('Identity'))).toEqual([
      expect.objectContaining({ group: `domain.${SHELL}`, area: `area.${HOME}` }),
    ])
    expect(ends(scene, peerClass('ticket_owner'))).toEqual([
      [peerClass('Ticket')],
      [shellClass('Identity')],
    ])
  })

  test('ids stay unique when both Domains declare a Class of one name', () => {
    expect(node(scene, 'class.Role')).toMatchObject({ area: `area.${HOME}` })
    expect(node(scene, peerClass('Role'))).toMatchObject({ area: `area.${PEER}` })
    expectUniqueIds(scene)
  })

  test('from the peer, the open Domain is the area drawn beside it', () => {
    const reverse = composeStructure(peerBundle(), {}, whole(homeBundle()))
    expect(reverse.areas?.map((area) => [area.id, area.home === true])).toEqual([
      [`area.${PEER}`, true],
      [`area.${HOME}`, false],
    ])
    expect(node(reverse, `class.${HOME}:class.Member`)).toMatchObject({
      kind: 'class',
      anchor: 'class.Member',
      anchorDomain: 'home-id',
    })
    expect(ends(reverse, 'class.ticket_watched_by')).toEqual([
      ['class.Ticket'],
      [`class.${HOME}:class.Member`],
    ])
    expectUniqueIds(reverse)
  })
})

describe('Structure with two Domains drawn whole', () => {
  test('three areas, in the order asked; each relationship between two of them drawn once', () => {
    const scene = composeStructure(homeBundle(), {}, whole(peerBundle(), thirdBundle()))
    expect(scene.areas?.map((area) => area.id)).toEqual([
      `area.${HOME}`,
      `area.${PEER}`,
      `area.${THIRD}`,
    ])
    expect(ends(scene, `class.${THIRD}:class.site_serves`)).toEqual([
      [`class.${THIRD}:class.Site`],
      [peerClass('Ticket')],
    ])
    expect(scene.links.filter((each) => each.label === 'site_serves')).toHaveLength(1)
    expectUniqueIds(scene)
  })

  test('a hidden Domain both reach lands on one node, drawn once', () => {
    const scene = composeStructure(
      homeBundle(),
      {},
      { ...whole(peerBundle()), shares: { [PEER]: 'whole', [SHELL]: 'hidden' } },
    )
    expect(scene.nodes.filter((each) => each.id === `domain.${SHELL}`)).toHaveLength(1)
    expect(ends(scene, peerClass('ticket_owner'))).toEqual([
      [peerClass('Ticket')],
      [`domain.${SHELL}`],
    ])
  })
})

describe('Structure with the Kernel drawn whole', () => {
  test('a Domain outside the Workspace whose Schema is read is an area like any other', () => {
    const kernel = domainBundle('kernel.astrale.ai', '@kernel', { Identity: nodeClass('Identity') })
    const home = homeBundle()
    home.ir!.classes.member_is = edgeClass('member_is', [
      end('member', HOME, 'Member'),
      end('identity', 'kernel.astrale.ai', 'Identity'),
    ])
    const scene = composeStructure(
      home,
      {},
      {
        shares: { 'kernel.astrale.ai': 'whole' },
        whole: [{ bundle: kernel, label: 'Kernel' }],
      },
    )
    expect(scene.areas?.[1]).toEqual({
      id: 'area.kernel.astrale.ai',
      origin: 'kernel.astrale.ai',
      domainId: '@kernel',
      label: 'Kernel',
      hue: expect.any(Number),
    })
    expect(node(scene, 'class.kernel.astrale.ai:class.Identity')).toMatchObject({
      kind: 'class',
      anchorDomain: '@kernel',
    })
    expect(ends(scene, 'class.member_is')[1]).toEqual(['class.kernel.astrale.ai:class.Identity'])
  })
})

describe('the hue of a Domain’s area', () => {
  test('is the Domain’s own wherever nothing before it holds that hue', () => {
    const [alone] = areaHues(['billing.example.dev'])
    expect(areaHues(['crm.example.dev', 'billing.example.dev'])).toContain(alone)
  })

  test('is never shared by two areas of one canvas', () => {
    const origins = [
      'a.example.dev',
      'b.example.dev',
      'c.example.dev',
      'd.example.dev',
      'e.example.dev',
    ]
    const hues = areaHues(origins)
    expect(new Set(hues).size).toBe(origins.length)
    // the same Domains in the same order wear the same hues again
    expect(areaHues(origins)).toEqual(hues)
  })
})
