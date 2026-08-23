import type { ClientSession } from '@astrale-os/kernel-client/session'
import type { CallableReference } from '@astrale-os/sdk/client/session'

import {
  callableAddress,
  core,
  defineSchema,
  edgeClass,
  method,
  nodeClass,
  property,
  schema,
} from '@astrale-os/sdk/schema'
import { mock } from 'bun:test'

import type { AdminBinding } from '../binding'

const operation = () =>
  method({
    auth: 'authenticated',
    input: { type: 'object', additionalProperties: true },
    output: { type: 'object', additionalProperties: true },
  })

const Domain = nodeClass({
  properties: {
    origin: property({ type: 'string' }, { required: true }),
    name: property({ type: 'string' }, { required: true }),
    discoveryUrl: property({ type: 'string' }, { required: true }),
    description: property({ type: 'string' }),
    createdAt: property({ type: 'string' }, { required: true }),
    updatedAt: property({ type: 'string' }, { required: true }),
  },
  methods: { configureDefault: operation() },
})
const Fleet = nodeClass({
  methods: {
    publishDomain: operation(),
    listInstances: operation(),
    createInstance: operation(),
  },
})
const Host = nodeClass({
  properties: {
    id: property({ type: 'string' }, { required: true }),
    state: property({ type: 'string' }, { required: true }),
  },
  methods: { createInstance: operation() },
})
const Instance = nodeClass({
  methods: {
    status: operation(),
    delete: operation(),
    installDomain: operation(),
  },
})
const fleet_installs_domain_by_default = edgeClass.directed({
  source: { as: 'fleet', accepts: [Fleet], outgoing: '0..*' },
  target: { as: 'domain', accepts: [Domain], incoming: '0..*' },
})
const fleet_reserves_admin_host = edgeClass.directed({
  source: { as: 'fleet', accepts: [Fleet], outgoing: '0..1' },
  target: { as: 'host', accepts: [Host], incoming: '0..1' },
})

export const AdminTestSchema = defineSchema('admin.astrale.ai', {
  classes: {
    Domain,
    Fleet,
    Host,
    Instance,
    fleet_installs_domain_by_default,
    fleet_reserves_admin_host,
  },
  core: { nodes: { fleet: core.node(() => Fleet, {}) }, edges: [] },
})

export const AdminTestDomain = schema.resolve(AdminTestSchema)

export function adminBinding(): AdminBinding {
  return { domain: AdminTestDomain, graph: {} } as unknown as AdminBinding
}

export function adminSession(
  implementation?: (
    method: { readonly owner: string; readonly name: string },
    receiver: unknown,
    input: unknown,
  ) => unknown,
) {
  const invoke = mock(async (reference: CallableReference, input: unknown) => {
    const address = callableAddress(reference.callable)
    if (address.kind !== 'method') throw new Error('Expected an Admin Method.')
    return implementation?.(
      { owner: address.owner.name, name: address.name },
      reference.target,
      input,
    )
  })
  return { invoke, session: { invoke } as unknown as ClientSession }
}
