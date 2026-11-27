/**
 * Several small Domains that reach each other, built by hand: an open Domain, a peer, a
 * third Domain reaching the peer, and Shell reached by both without its Schema at hand.
 */

import type { IrClass, StudioSchemaBundle } from '@shared/contracts/schema'

import type { StructureComposition } from '../structure'

import {
  bundle,
  classRef,
  edgeClass,
  importClass,
  nodeClass,
} from '../../../schema-studio/__tests__/fixture'

export const HOME = 'home.example.dev'
export const PEER = 'peer.example.dev'
export const THIRD = 'third.example.dev'
export const SHELL = 'shell.example.dev'

/** A Domain of `origin`, its Classes declared in the module folders given by name. */
export function domainBundle(
  origin: string,
  domainId: string,
  classes: Record<string, IrClass>,
  modules: Record<string, string> = {},
): StudioSchemaBundle {
  const owned = Object.fromEntries(
    Object.entries(classes).map(([name, member]) => [
      name,
      { ...member, origin, ref: classRef(origin, name) },
    ]),
  )
  const value = bundle(owned, { domainId, renderFingerprint: `${domainId}-render` })
  value.ir!.domain = origin
  for (const [name, module] of Object.entries(modules)) {
    const kind = owned[name]!.type === 'edge' ? 'edge' : 'class'
    value.overlay.sourceSpans[`${kind}.${name}`] = {
      file: `schema/modules/${module}/${name}.ts`,
      startLine: 1,
      endLine: 4,
    }
  }
  return value
}

/** A relationship end named `name`, accepting `type` of `origin`. */
export const end = (name: string, origin: string, type: string) => ({
  name,
  types: [type],
  refs: [classRef(origin, type)],
})

/** The open Domain: a Member of its own, a Role, and relationships to a peer and to Shell. */
export function homeBundle(): StudioSchemaBundle {
  const value = domainBundle(
    HOME,
    'home-id',
    {
      Member: nodeClass('Member', { properties: { email: { type: 'string' } } }),
      Role: nodeClass('Role'),
      member_has_role: edgeClass('member_has_role', [
        end('member', HOME, 'Member'),
        end('role', HOME, 'Role'),
      ]),
      member_files: edgeClass('member_files', [
        end('member', HOME, 'Member'),
        end('ticket', PEER, 'Ticket'),
      ]),
      member_is: edgeClass('member_is', [
        end('member', HOME, 'Member'),
        end('identity', SHELL, 'Identity'),
      ]),
    },
    { Member: 'people', member_has_role: 'people' },
  )
  importClass(value, classRef(PEER, 'Ticket'), nodeClass('Ticket', { origin: PEER }))
  importClass(value, classRef(SHELL, 'Identity'), nodeClass('Identity', { origin: SHELL }))
  return value
}

/** A peer Domain declaring a Role of its own too, and reaching the open Domain and Shell. */
export function peerBundle(): StudioSchemaBundle {
  const value = domainBundle(
    PEER,
    'peer-id',
    {
      Ticket: nodeClass('Ticket', { properties: { title: { type: 'string' } } }),
      Label: nodeClass('Label'),
      Role: nodeClass('Role'),
      ticket_has_label: edgeClass('ticket_has_label', [
        end('ticket', PEER, 'Ticket'),
        end('label', PEER, 'Label'),
      ]),
      ticket_role: edgeClass('ticket_role', [
        end('ticket', PEER, 'Ticket'),
        end('role', PEER, 'Role'),
      ]),
      ticket_owner: edgeClass('ticket_owner', [
        end('ticket', PEER, 'Ticket'),
        end('owner', SHELL, 'Identity'),
      ]),
      ticket_watched_by: edgeClass('ticket_watched_by', [
        end('ticket', PEER, 'Ticket'),
        end('watcher', HOME, 'Member'),
      ]),
    },
    { Ticket: 'tickets', Label: 'tickets', ticket_has_label: 'tickets' },
  )
  importClass(value, classRef(SHELL, 'Identity'), nodeClass('Identity', { origin: SHELL }))
  importClass(value, classRef(HOME, 'Member'), nodeClass('Member', { origin: HOME }))
  return value
}

export function thirdBundle(): StudioSchemaBundle {
  const value = domainBundle(THIRD, 'third-id', {
    Site: nodeClass('Site'),
    site_serves: edgeClass('site_serves', [
      end('site', THIRD, 'Site'),
      end('ticket', PEER, 'Ticket'),
    ]),
  })
  importClass(value, classRef(PEER, 'Ticket'), nodeClass('Ticket', { origin: PEER }))
  return value
}

export const peerClass = (name: string) => `class.${PEER}:class.${name}`
export const shellClass = (name: string) => `class.${SHELL}:class.${name}`

export const whole = (...bundles: StudioSchemaBundle[]): StructureComposition => ({
  shares: Object.fromEntries(bundles.map((value) => [value.ir!.domain, 'whole' as const])),
  whole: bundles.map((value) => ({ bundle: value, label: value.domainId, version: '1.0.0' })),
  home: { label: 'Home', version: '0.4.0' },
})
