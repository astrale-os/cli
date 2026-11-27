import { classIcon, defineSchema, edgeClass, nodeClass, valueSchema } from '@astrale-os/sdk/schema'

import { CrmSchema, Team } from './crm.js'

const string = valueSchema<string>()({ type: 'string' })

const Company = nodeClass({
  policies: { read: true },
  icon: classIcon.neutral,
  description: 'The operating company used to verify homonymous multi-domain targeting.',
  properties: { legalName: string },
})

const Region = nodeClass({
  policies: { read: true },
  icon: classIcon.neutral,
  description: 'An operating region managed by the Ops domain.',
  properties: { name: string },
})

const OperatesIn = edgeClass.directed({
  policies: { read: true },
  source: { as: 'company', accepts: [Company], outgoing: '0..*' },
  target: { as: 'region', accepts: [Region], incoming: '0..*' },
})

/** A relationship whose other end is a Class of the Crm Domain. */
const ServedBy = edgeClass.directed({
  policies: { read: true },
  source: { as: 'region', accepts: [Region], outgoing: '0..*' },
  target: { as: 'team', accepts: [Team], incoming: '0..*' },
})

export const StudioPeerE2ESchema = defineSchema('ops.studio-demo.astrale.ai', {
  name: 'Test Domain',
  dependencies: { crm: CrmSchema },
  classes: { Company, Region, OperatesIn, ServedBy },
})

export type StudioPeerE2ESchema = typeof StudioPeerE2ESchema
