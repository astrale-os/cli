import { describe, expect, test } from 'bun:test'

import {
  bundle,
  classRef,
  edgeClass,
  importClass,
  nodeClass,
} from '../../schema-studio/__tests__/fixture'
import { OPTION_GLYPHS } from '../canvas/glyphs'
import { LENSES, optionsOf, sceneOf } from './index'
import { NO_COMPOSITION, type StructureComposition } from './structure'

describe('lens options', () => {
  test('no two toggles of one lens look alike', () => {
    for (const lens of LENSES) {
      const pictures = lens.options.map((option) => OPTION_GLYPHS[option.icon])
      expect(pictures.every(Boolean)).toBe(true)
      expect(new Set(pictures).size).toBe(pictures.length)
    }
  })
})

describe('the Scene of a lens', () => {
  const PEER = 'peer.example.dev'
  const open = () => {
    const value = bundle({
      Member: nodeClass('Member'),
      member_files: edgeClass('member_files', [
        { name: 'member', types: ['Member'], refs: [classRef('local.example.dev', 'Member')] },
        { name: 'ticket', types: ['Ticket'], refs: [classRef(PEER, 'Ticket')] },
      ]),
    })
    importClass(value, classRef(PEER, 'Ticket'), nodeClass('Ticket', { origin: PEER }))
    return value
  }
  const peer = bundle({ Ticket: nodeClass('Ticket', { origin: PEER }) }, { domainId: 'peer' })
  peer.ir!.domain = PEER
  const composition: StructureComposition = {
    shares: { [PEER]: 'whole' },
    whole: [{ bundle: peer, label: 'Peer' }],
  }

  test('only Structure draws other Domains: every other lens reads the open Domain alone', () => {
    for (const lens of LENSES) {
      if (!lens.project) continue
      const options = optionsOf(lens, undefined)
      const alone = sceneOf(lens, open(), options)
      expect(alone).toEqual(lens.project(open(), options))
      expect(sceneOf(lens, open(), options, undefined, undefined, NO_COMPOSITION)).toEqual(alone)
      const composed = sceneOf(lens, open(), options, undefined, undefined, composition)
      if (lens.id === 'structure') expect(composed?.areas).toHaveLength(2)
      else expect(composed).toEqual(alone)
    }
  })
})
