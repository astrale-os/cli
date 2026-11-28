import type {
  DefinitionEffect,
  DefinitionLink,
  HandlerLink,
  IrMethod,
  StudioDataset,
  StudioSchemaBundle,
} from '@shared/contracts/schema'

import {
  bundle,
  classRef,
  edgeClass,
  importClass,
  nodeClass,
} from '../../../../schema-studio/__tests__/fixture'

/**
 * A help desk, small enough to read whole: Desks hold Tickets, a Ticket carries Labels and is
 * handled by an Agent, an Agent staffs Desks. Two Desks, five Tickets, two Labels, three Agents.
 */

const HOME = 'local.example.dev'
const KERNEL = 'kernel.astrale.ai'
const local = (name: string) => classRef(HOME, name)
const MANY = { min: 0, max: null }
const ONE = { min: 1, max: 1 }

const end = (name: string, type: string, cardinality: { min: number; max: number | null }) => ({
  name,
  types: [type],
  refs: [{ ...local(type), kind: 'class' as const }],
  cardinality,
})

const read = (cls: string, role: 'root' | 'traverse'): DefinitionEffect => ({
  kind: 'read',
  class: cls,
  verb: role === 'root' ? 'where' : 'via',
  file: 'queries.ts',
  line: 1,
  role,
})

const query = (
  id: string,
  name: string,
  effects: DefinitionEffect[],
  doc?: string,
): DefinitionLink => ({
  kind: 'query',
  id,
  name,
  file: 'queries.ts',
  line: 1,
  classes: [...new Set(effects.map((effect) => effect.class))],
  effects,
  ...(doc ? { doc } : {}),
})

export const QUERIES = {
  ticketsOfDesk: query(
    'desk.tickets',
    'ticketsOfDesk',
    [
      read('Ticket', 'root'),
      read('desk_holds_ticket', 'traverse'),
      read('Desk', 'traverse'),
      read('ticket_carries_label', 'traverse'),
      read('Label', 'traverse'),
      read('ticket_handled_by', 'traverse'),
      read('Agent', 'traverse'),
    ],
    'A Desk’s Tickets, each with its Labels and the Agent who handles it.',
  ),
  deskStaff: query('desk.staff', 'deskStaff', [
    read('Desk', 'root'),
    read('agent_staffs_desk', 'traverse'),
    read('Agent', 'traverse'),
  ]),
  labels: query('desk.labels', 'everyLabel', [read('Label', 'root')]),
}

const method = (name: string, isStatic: boolean): IrMethod => ({
  name,
  input: { type: 'object' },
  output: { mode: 'value', schema: { type: 'null' } },
  static: isStatic,
  abstract: false,
  executable: true,
})

const write = (kind: DefinitionEffect['kind'], cls: string): DefinitionEffect => ({
  kind,
  class: cls,
  verb: kind,
  file: 'mutations.ts',
  line: 1,
})

/** `Ticket.assign` hands a Ticket to an Agent; `Desk.open` is static and creates a Desk. */
const MUTATIONS: DefinitionLink[] = [
  {
    kind: 'mutation',
    id: 'desk.ticket.assign',
    name: 'assignTicket',
    file: 'mutations.ts',
    line: 1,
    classes: ['Ticket', 'ticket_handled_by'],
    effects: [write('update', 'Ticket'), write('create', 'ticket_handled_by')],
  },
  {
    kind: 'mutation',
    id: 'desk.desk.open',
    name: 'openDesk',
    file: 'mutations.ts',
    line: 9,
    classes: ['Desk'],
    effects: [write('create', 'Desk')],
  },
]

const HANDLERS: HandlerLink[] = [
  {
    owner: 'Ticket',
    ownerKind: 'class',
    kind: 'action',
    method: 'assign',
    static: false,
    implemented: true,
    definitions: ['desk.ticket.assign'],
  },
  {
    owner: 'Desk',
    ownerKind: 'class',
    kind: 'action',
    method: 'open',
    static: true,
    implemented: true,
    definitions: ['desk.desk.open'],
  },
]

export function deskBundle(): StudioSchemaBundle {
  const agent = nodeClass('Agent', {
    extends: ['Identity'],
    extendsRefs: [classRef(KERNEL, 'Identity')],
  })
  const value = bundle(
    {
      Desk: nodeClass('Desk', { methods: { open: method('open', true) } }),
      Ticket: nodeClass('Ticket', { methods: { assign: method('assign', false) } }),
      Label: nodeClass('Label'),
      Agent: agent,
      desk_holds_ticket: edgeClass('desk_holds_ticket', [
        end('desk', 'Desk', MANY),
        end('ticket', 'Ticket', ONE),
      ]),
      ticket_carries_label: edgeClass('ticket_carries_label', [
        end('ticket', 'Ticket', MANY),
        end('label', 'Label', MANY),
      ]),
      ticket_handled_by: edgeClass('ticket_handled_by', [
        end('ticket', 'Ticket', { min: 0, max: 1 }),
        end('agent', 'Agent', MANY),
      ]),
      agent_staffs_desk: edgeClass('agent_staffs_desk', [
        end('agent', 'Agent', MANY),
        end('desk', 'Desk', MANY),
      ]),
    },
    {
      overlay: {
        handlerLinks: HANDLERS,
        definitions: [...Object.values(QUERIES), ...MUTATIONS],
        integrations: [],
        sourceSpans: {},
      },
    },
  )
  importClass(value, classRef(KERNEL, 'Identity'), {
    ...nodeClass('Identity'),
    origin: KERNEL,
    ref: classRef(KERNEL, 'Identity'),
  })
  return value
}

const node = (
  path: string,
  className: string,
  name: string,
  more: Record<string, unknown> = {},
) => ({
  path,
  className,
  data: { name, ...more },
})
const edge = (from: string, edgeName: string, to: string) => ({ from, to, edgeName })

export function deskDataset(): StudioDataset {
  return {
    status: 'ready',
    path: './tests/datasets/desk.ts',
    id: 'desk',
    title: 'A help desk',
    origin: HOME,
    revision: 'sha256:0',
    schemaMatch: true,
    references: {},
    nodes: [
      node('ana', 'Agent', 'Ana'),
      node('ben', 'Agent', 'Ben'),
      node('cy', 'Agent', 'Cy'),
      node('billing', 'Desk', 'Billing'),
      node('support', 'Desk', 'Support'),
      node('urgent', 'Label', 'Urgent'),
      node('refund', 'Label', 'Refund'),
      node('t1', 'Ticket', 'Card declined', { status: 'open' }),
      node('t2', 'Ticket', 'Double charge', { status: 'open' }),
      node('t3', 'Ticket', 'Invoice copy', { status: 'closed' }),
      node('t4', 'Ticket', 'Login loop', { status: 'open' }),
      node('t5', 'Ticket', 'Slow export', { status: 'closed' }),
    ],
    edges: [
      edge('billing', 'desk_holds_ticket', 't1'),
      edge('billing', 'desk_holds_ticket', 't2'),
      edge('billing', 'desk_holds_ticket', 't3'),
      edge('support', 'desk_holds_ticket', 't4'),
      edge('support', 'desk_holds_ticket', 't5'),
      edge('t1', 'ticket_carries_label', 'urgent'),
      edge('t2', 'ticket_carries_label', 'urgent'),
      edge('t2', 'ticket_carries_label', 'refund'),
      edge('t1', 'ticket_handled_by', 'ana'),
      edge('t2', 'ticket_handled_by', 'ben'),
      edge('t4', 'ticket_handled_by', 'ana'),
      edge('ana', 'agent_staffs_desk', 'billing'),
      edge('ana', 'agent_staffs_desk', 'support'),
      edge('ben', 'agent_staffs_desk', 'billing'),
    ],
    variables: { billing: ['billing'], declined: ['t1'], ana: ['ana'] },
  }
}
