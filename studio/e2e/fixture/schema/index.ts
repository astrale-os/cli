import { defineSchema, node, nodeClass, property, view } from '@astrale-os/sdk/schema'

const Monitor = nodeClass({
  description: 'A monitored resource rendered by the browser smoke test.',
  properties: {
    name: property({ type: 'string' }, { required: true }),
    label: property({ type: 'string' }, { required: true }),
    healthy: property({ type: 'boolean' }, { required: false }),
  },
})

const primary = node(Monitor, {
  name: 'Primary monitor',
  label: 'Browser fixture',
  healthy: true,
})

export const schema = defineSchema('studio-e2e.astrale.ai', {
  classes: { Monitor },
  views: {
    overview: view({
      description: 'Fixture overview.',
      target: 'domain',
      auth: 'public',
    }),
  },
  core: { nodes: { primary } },
})
