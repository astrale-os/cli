import * as sdk from '@astrale-os/sdk/schema'
import { describe, expect, test } from 'bun:test'

import type { Scene, SceneRule } from '../scene/types'

import {
  type CanonicalDomainSchemaV1,
  extractCanonicalSchemaFromSdk,
  type SchemaSdk,
} from '../../../../server/introspect/canonical-schema'
import { bundle } from '../../schema-studio/__tests__/fixture'
import { markWords } from '../rules/admission'
import { projectRules } from './rules'

/**
 * A help desk, admitted by the installed SDK as the server admits an authored Schema: Agents,
 * Kernel identities, raise Tickets; with its Desks, an Agent is a member of a Desk, leads it or
 * owns it, each read by a Policy of its own.
 */
function helpDesk(origin: string, desks: boolean) {
  const { classIcon, defineSchema, edgeClass, K, KernelSchema, nodeClass, policy } = sdk
  const raisedTicket = policy({
    match: ({ edge, subject, object }) =>
      edge({ source: object, class: () => RaisedBy, target: subject }),
  })
  const Agent = nodeClass({
    icon: classIcon.neutral,
    extends: [K.classes.Identity],
    policies: { read: true },
    properties: {},
  })
  const Ticket = nodeClass({
    icon: classIcon.neutral,
    policies: { read: true, update: () => raisedTicket },
    properties: {},
  })
  const RaisedBy = edgeClass.directed({
    policies: { read: true },
    source: { as: 'ticket', accepts: [Ticket], outgoing: '0..*' },
    target: { as: 'reporter', accepts: [Agent], incoming: '0..*' },
  })
  if (!desks)
    return defineSchema(origin, {
      name: 'Help desk',
      dependencies: { kernel: KernelSchema },
      classes: { Agent, Ticket, RaisedBy },
      policies: { raisedTicket },
    })

  const isDeskMember: sdk.Policy = policy({
    description: 'The caller is a member of this Desk.',
    match: ({ edge, subject, object }) =>
      edge({ source: subject, class: () => MemberOf, target: object }),
  })
  const isDeskLead: sdk.Policy = policy({
    match: ({ edge, subject, object }) =>
      edge({ source: subject, class: () => Leads, target: object }),
  })
  const isDeskOwner: sdk.Policy = policy({
    match: ({ edge, subject, object }) =>
      edge({ source: subject, class: () => Owns, target: object }),
  })
  const Desk = nodeClass({
    icon: classIcon.neutral,
    policies: {
      read: () => isDeskMember,
      traverse: () => isDeskMember,
      update: () => isDeskLead,
      delete: () => isDeskOwner,
    },
    properties: {},
  })
  const MemberOf = edgeClass.directed({
    policies: { read: true },
    source: { as: 'member', accepts: [Agent], outgoing: '0..*' },
    target: { as: 'desk', accepts: [Desk], incoming: '0..*' },
  })
  const Leads = edgeClass.directed({
    policies: { read: true },
    source: { as: 'lead', accepts: [Agent], outgoing: '0..*' },
    target: { as: 'desk', accepts: [Desk], incoming: '0..*' },
  })
  const Owns = edgeClass.directed({
    policies: { read: true },
    source: { as: 'owner', accepts: [Agent], outgoing: '0..*' },
    target: { as: 'desk', accepts: [Desk], incoming: '0..*' },
  })
  return defineSchema(origin, {
    name: 'Help desk',
    dependencies: { kernel: KernelSchema },
    classes: { Agent, Desk, Ticket, MemberOf, Leads, Owns, RaisedBy },
    policies: { isDeskMember, isDeskLead, isDeskOwner, raisedTicket },
  })
}

/** The Rules map of a Schema the installed SDK admits. */
function rulesMap(schema: unknown): Scene {
  const admitted = extractCanonicalSchemaFromSdk(
    sdk as unknown as SchemaSdk,
    schema as CanonicalDomainSchemaV1,
  )
  expect(admitted.status).toBe('admitted')
  return projectRules(
    bundle(
      {},
      {
        domainId: 'desk',
        ir: admitted.ir,
        schemaRoot: admitted.root,
        schemaClosure: [...(admitted.closure ?? [])],
      },
    ),
    {},
  )
}

const desk = rulesMap(helpDesk('desk.example.dev', true))

const rowOf = (scene: Scene, id: string): SceneRule | undefined =>
  scene.nodes.flatMap((node) => node.rules ?? []).find((row) => row.id === id)

describe('the Index', () => {
  test('lists the Policies in words, under the family their names open with, the rest after', () => {
    expect(desk.index!.groups).toEqual([
      { id: 'policies.is-desk', label: 'Is Desk', phrase: true },
      { id: 'rules.who', label: 'Other Policies' },
      { id: 'rules.what', label: 'Constraints' },
    ])
    expect(
      desk
        .index!.entries.filter((entry) => entry.kind === 'policy')
        .map((entry) => [entry.group, entry.label, entry.sublabel]),
    ).toEqual([
      ['policies.is-desk', '… lead', '1 place'],
      ['policies.is-desk', '… member', '2 places'],
      ['policies.is-desk', '… owner', '1 place'],
      ['rules.who', 'raised Ticket', '1 place'],
    ])
  })

  test('a Policy is found by its name as written, its whole phrase and its description', () => {
    const member = desk.index!.entries.find(
      (entry) => entry.id === 'policy.desk.example.dev:policy.isDeskMember',
    )!
    expect(member.keywords).toEqual([
      'isDeskMember',
      'is Desk member',
      'The caller is a member of this Desk.',
    ])
  })

  test('with no family, the Policies are listed under one group of their own', () => {
    const alone = rulesMap(helpDesk('tickets.example.dev', false))
    expect(alone.index!.groups).toEqual([
      { id: 'rules.who', label: 'Policies' },
      { id: 'rules.what', label: 'Constraints' },
    ])
    expect(alone.index!.entries.filter((entry) => entry.kind === 'policy')).toMatchObject([
      { group: 'rules.who', label: 'raised Ticket', keywords: ['raisedTicket', 'raised Ticket'] },
    ])
  })
})

describe('a slot left to the Kernel default', () => {
  test('reads whom it admits in a few words, the Kernel default in full on hover', () => {
    expect(rowOf(desk, 'class.Desk#create')).toMatchObject({
      marks: [{ op: 'create', admits: 'holders', unwritten: true }],
      text: 'Owning Domain only',
      title:
        'Only Root, desk (its Domain) and holders of the create capability on Desk may create one.',
      unwritten: true,
    })
    expect(rowOf(desk, 'class.Ticket#traverse')).toMatchObject({
      marks: [{ op: 'traverse', admits: 'open', unwritten: true }],
      title: 'Every caller may traverse one.',
    })
    // a read written `true` is the Kernel's default: the admitted Schema writes nothing there
    expect(rowOf(desk, 'class.Ticket#read')).toMatchObject({
      marks: [{ op: 'read', admits: 'open', unwritten: true }],
      text: 'Everyone',
      title: 'Every caller may read one.',
    })
    // a slot a Policy decides reads the Policy's condition instead
    expect(rowOf(desk, 'class.Desk#update')).toMatchObject({ text: 'you are a lead of it' })
  })

  test('its mark says whom it admits, then that nothing is written', () => {
    expect(markWords({ op: 'create', admits: 'holders', unwritten: true })).toBe(
      'create · owning Domain only, nothing written',
    )
    expect(markWords({ op: 'read', admits: 'open', unwritten: true })).toBe(
      'read · everyone, nothing written',
    )
    expect(markWords({ op: 'read', admits: 'policy' })).toBe('read · a Policy decides')
  })
})
