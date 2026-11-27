import { describe, expect, test } from 'bun:test'

import { arrange } from '../scene/arrange'
import { standingFor } from '../scene/focus'
import { behaviorBundle } from './__tests__/behavior-fixture'
import { projectBehavior } from './behavior'
import { projectStructure } from './structure'
import { spotlit, standIns } from './thread'

const bundle = behaviorBundle()
const structure = projectStructure(bundle, {})
const behavior = projectBehavior(bundle, {})

describe('the selection across lenses', () => {
  test('what a lens draws stands for itself', () => {
    expect(standIns(bundle, behavior, 'class.Host')).toEqual([])
    expect(standIns(bundle, structure, 'class.Host')).toEqual([])
    expect(standIns(bundle, behavior, undefined)).toEqual([])
  })

  test('in Structure, a function stands as what it writes, else as its Class', () => {
    // An Edge write links both ends in Behavior; in Structure the relationship itself joins them.
    expect(standIns(bundle, structure, 'function.Host.assign')).toEqual([
      'class.Fleet',
      'class.Host',
      'class.memberOf',
    ])
    expect(standIns(bundle, structure, 'function.provision')).toEqual(['class.Operation'])
    expect(standIns(bundle, structure, 'function.Fleet.inspect')).toEqual(['class.Fleet'])
    expect(standIns(bundle, structure, 'mutation.host.create')).toEqual([
      'class.Fleet',
      'class.Host',
      'class.hostedIn',
    ])
    expect(standIns(bundle, structure, 'integration.machines')).toEqual(['class.Host'])
  })

  test('in Behavior, a Class stands as its Methods; a relationship, also as where it is written', () => {
    expect(standIns(bundle, behavior, 'class.memberOf')).toEqual([
      'class.Fleet',
      'class.Host',
      'function.Host.assign',
      'function.Host.release',
    ])
    // A Class nothing changes, with no Methods, stands as its module.
    expect(standIns(bundle, behavior, 'class.Note')).toEqual(['module.modules/fleet'])
  })

  test('what stands in lights its boxes and the links among them, never one out to the rest', () => {
    const arrangement = arrange(behavior, { collapsed: new Set() })
    const lit = standingFor(behavior, arrangement, standIns(bundle, behavior, 'class.memberOf'))!
    expect([...lit.links].sort()).toEqual([
      'change:function.Host.assign:link:class.Fleet',
      'change:function.Host.assign:link:class.Host',
      'change:function.Host.release:unlink:class.Fleet',
      'change:function.Host.release:unlink:class.Host',
    ])
    expect(lit.boxes.has('function.Host.create')).toBe(false)
    expect(standingFor(behavior, arrangement, ['class.Nowhere'])).toBeNull()
  })

  test('things named with their proof light only the links they name, not every one between them', () => {
    const arrangement = arrange(behavior, { collapsed: new Set() })
    const ends = ['function.Host.assign', 'class.Host']
    const link = 'change:function.Host.assign:link:class.Host'
    expect(standingFor(behavior, arrangement, ends)!.links.has(link)).toBe(true)
    const named = standingFor(behavior, arrangement, ends, 'named')!
    expect([...named.links]).toEqual([])
    expect(named.boxes.has('class.Host')).toBe(true)
    expect([...standingFor(behavior, arrangement, [...ends, link], 'named')!.links]).toEqual([link])
  })
})

describe('a spotlight from a panel', () => {
  test('lights each id itself where the lens draws it, else what stands for it', () => {
    // a rule naming a Class and the relationship it walks, read in both lenses
    const ids = ['class.Host', 'class.memberOf']
    expect(spotlit(bundle, structure, ids)).toEqual(['class.Host', 'class.memberOf'])
    expect(spotlit(bundle, behavior, ids)).toEqual([
      'class.Fleet',
      'class.Host',
      'function.Host.assign',
      'function.Host.release',
    ])
    expect(spotlit(bundle, behavior, ['class.Nowhere'])).toEqual([])
  })
})
