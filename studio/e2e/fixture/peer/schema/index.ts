import { defineSchema, edgeClass, nodeClass, valueSchema } from '@astrale-os/sdk/schema'

const string = valueSchema<string>()({ type: 'string' })

const Company = nodeClass({
  description: 'The operating company used to verify homonymous multi-domain targeting.',
  properties: { legalName: string },
})

const Region = nodeClass({
  description: 'An operating region managed by the Ops domain.',
  properties: { name: string },
})

const OperatesIn = edgeClass.directed({
  source: { as: 'company', accepts: [Company], outgoing: '0..*' },
  target: { as: 'region', accepts: [Region], incoming: '0..*' },
})

export const StudioPeerE2ESchema = defineSchema('ops.studio-demo.astrale.ai', {
  classes: { Company, Region, OperatesIn },
})

export type StudioPeerE2ESchema = typeof StudioPeerE2ESchema
