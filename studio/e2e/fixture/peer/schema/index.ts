import { defineSchema, nodeClass, valueSchema } from '@astrale-os/sdk/schema'

const string = valueSchema<string>()({ type: 'string' })

const Monitor = nodeClass({
  description: 'The homonymous monitor used to verify multi-domain targeting.',
  properties: { label: string },
})

export const StudioPeerE2ESchema = defineSchema('studio-peer-e2e.astrale.ai', {
  classes: { Monitor },
})

export type StudioPeerE2ESchema = typeof StudioPeerE2ESchema
