import { defineSchema, nodeClass, view } from '@astrale-os/sdk/schema'

const Monitor = nodeClass({
  description: 'A monitored resource rendered by the browser smoke test.',
  properties: {},
})

export const StudioE2ESchema = defineSchema('studio-e2e.astrale.ai', {
  classes: { Monitor },
  views: {
    overview: view({
      description: 'Fixture overview.',
      target: 'domain',
    }),
  },
})

export type StudioE2ESchema = typeof StudioE2ESchema
