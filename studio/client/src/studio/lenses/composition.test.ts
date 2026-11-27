import { describe, expect, test } from 'bun:test'

import {
  HOME,
  homeBundle,
  PEER,
  peerBundle,
  peerClass,
  SHELL,
  shellClass,
  THIRD,
} from './__tests__/several-domains'
import {
  canvasIdOf,
  domainChoices,
  namedOnlyBeside,
  type ReadableDomains,
  reachedOrigins,
  redraws,
  wholeDomainIds,
} from './composition'

const KERNEL = 'kernel.example.dev'
/** The open Domain, the peer and a third Domain in the Workspace; the Kernel held outside it. */
const readable: ReadableDomains = {
  workspace: new Map([
    [HOME, 'home-id'],
    [THIRD, 'third-id'],
    [PEER, 'peer-id'],
  ]),
  outside: new Map([[KERNEL, 'kernel-id']]),
}
const nothing = new Set<string>()

/** The open Domain, depending on the Kernel besides what it reaches. */
function homeDepending() {
  const value = homeBundle()
  value.ir!.dependencies = [{ origin: KERNEL, revision: 'sha256:0' }]
  return value
}

describe('the Domains a Structure canvas offers', () => {
  test('every other Workspace Domain, then those outside it the open one depends on or reaches, each by name', () => {
    const choices = domainChoices(homeDepending(), readable, {}, nothing)
    expect(choices.map(({ origin, label, place }) => [origin, label, place])).toEqual([
      [PEER, 'Peer', 'workspace'],
      [THIRD, 'Third', 'workspace'],
      [KERNEL, 'Kernel', 'outside'],
      [SHELL, 'Shell', 'outside'],
    ])
    // each reached by default
    expect(choices.every((choice) => choice.drawn === 'reached')).toBe(true)
  })

  test('a Domain whose Schema cannot be read is never whole, and says why', () => {
    const choices = domainChoices(homeDepending(), readable, { [SHELL]: 'whole' }, nothing)
    const shell = choices.find((choice) => choice.origin === SHELL)!
    expect(shell.drawn).toBe('reached')
    expect(shell.noWhole).toBe(
      'Only the Classes Home reaches are known here: the Studio cannot read its own Schema.',
    )
    // the Kernel, held outside the Workspace, can be
    expect(choices.find((choice) => choice.origin === KERNEL)!.noWhole).toBeUndefined()
    expect(wholeDomainIds(choices, readable)).toEqual([])
  })

  test('a Domain drawn whole says it is being read, then that it could not be', () => {
    const shares = { [PEER]: 'whole', [THIRD]: 'hidden' } as const
    const reading = domainChoices(homeBundle(), readable, shares, nothing)
    expect(reading.find((choice) => choice.origin === PEER)).toMatchObject({
      drawn: 'whole',
      reading: true,
    })
    expect(reading.find((choice) => choice.origin === THIRD)).toMatchObject({ drawn: 'hidden' })
    const read = domainChoices(homeBundle(), readable, shares, new Set([PEER]))
    expect(read.find((choice) => choice.origin === PEER)!.reading).toBeUndefined()
    const failed = domainChoices(homeBundle(), readable, shares, nothing, new Set([PEER]))
    expect(failed.find((choice) => choice.origin === PEER)!.note).toBe(
      'Its Schema could not be read: it is drawn as reached meanwhile.',
    )
  })

  test('the Domains read whole are read in the order they are offered', () => {
    const shares = { [THIRD]: 'whole', [KERNEL]: 'whole', [PEER]: 'whole' } as const
    const choices = domainChoices(homeDepending(), readable, shares, nothing)
    expect(wholeDomainIds(choices, readable)).toEqual(['peer-id', 'third-id', 'kernel-id'])
  })

  test('the open Domain is never offered, and one with no other Domain around offers none', () => {
    const alone = homeBundle()
    alone.ir!.importsByKey = {}
    alone.ir!.importedClassesByKey = {}
    const only = { workspace: new Map([[HOME, 'home-id']]), outside: new Map() }
    expect(domainChoices(alone, only, {}, nothing)).toEqual([])
    expect(reachedOrigins(alone)).toEqual(new Set())
    expect(reachedOrigins(homeBundle())).toEqual(new Set([PEER, SHELL]))
  })
})

describe('what a change of choice redraws', () => {
  test('a Domain drawn whole, before or after, always; hidden and reached only when reached', () => {
    const bundle = homeBundle()
    expect(redraws(bundle, THIRD, 'reached', 'whole')).toBe(true)
    expect(redraws(bundle, THIRD, 'whole', 'hidden')).toBe(true)
    expect(redraws(bundle, PEER, 'reached', 'hidden')).toBe(true)
    // the open Domain reaches nothing of the third: hidden or reached, nothing of it is drawn
    expect(redraws(bundle, THIRD, 'reached', 'hidden')).toBe(false)
    expect(redraws(bundle, PEER, 'whole', 'whole')).toBe(false)
  })
})

describe('a selection across Domains', () => {
  test('names only what a Domain beside declares when the open Domain does not import it', () => {
    const bundle = homeBundle()
    // the peer's Label, or one of its modules: only the peer's Schema names them
    expect(namedOnlyBeside(bundle, peerClass('Label'))).toBe(true)
    expect(namedOnlyBeside(bundle, `module.tickets@${PEER}`)).toBe(true)
    expect(namedOnlyBeside(bundle, peerClass('ticket_has_label'))).toBe(true)
    // the peer's Ticket, imported; the open Domain's own; a module of its own
    expect(namedOnlyBeside(bundle, peerClass('Ticket'))).toBe(false)
    expect(namedOnlyBeside(bundle, shellClass('Identity'))).toBe(false)
    expect(namedOnlyBeside(bundle, 'class.Member')).toBe(false)
    expect(namedOnlyBeside(bundle, 'module.people')).toBe(false)
    expect(namedOnlyBeside(bundle, 'domain.peer.example.dev')).toBe(false)
  })

  test('a Class keeps one canvas id whichever Domain names it', () => {
    // the peer names its own Ticket bare; the open Domain's canvas names it by its key
    expect(canvasIdOf('class.Ticket', PEER, HOME)).toBe(peerClass('Ticket'))
    expect(canvasIdOf('edge.ticket_has_label', PEER, HOME)).toBe(peerClass('ticket_has_label'))
    // the peer names the open Domain's Member by its key; the open Domain's canvas, bare
    expect(canvasIdOf(`class.${HOME}:class.Member`, PEER, HOME)).toBe('class.Member')
    expect(canvasIdOf('class.Member', HOME, HOME)).toBe('class.Member')
    // what names no Class has none
    expect(canvasIdOf('class.Ticket.property.title', PEER, HOME)).toBeUndefined()
    expect(canvasIdOf('module.tickets', PEER, HOME)).toBeUndefined()
  })
})

test('the peer bundle reaches the open Domain and Shell', () => {
  expect(reachedOrigins(peerBundle())).toEqual(new Set([HOME, SHELL]))
})
