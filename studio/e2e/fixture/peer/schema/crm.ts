import { classIcon, defineSchema, nodeClass, valueSchema } from '@astrale-os/sdk/schema'

const string = valueSchema<string>()({ type: 'string' })

/** The Crm Domain's Team, as the Ops Domain imports it: a relationship across two Workspace Domains. */
export const Team = nodeClass({
  policies: { read: true },
  icon: classIcon.neutral,
  description: 'An internal team owning a set of accounts.',
  properties: { name: string, region: string },
})

export const CrmSchema = defineSchema('crm.studio-demo.astrale.ai', {
  name: 'Test Domain',
  classes: { Team },
})
