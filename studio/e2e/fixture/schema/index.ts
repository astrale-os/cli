import {
  core,
  defineSchema,
  edgeClass,
  nodeClass,
  property,
  valueSchema,
  view,
} from '@astrale-os/sdk/schema'

const string = valueSchema<string>()({ type: 'string' })
const boolean = valueSchema<boolean>()({ type: 'boolean' })

const Monitor = nodeClass({
  description: 'A monitored resource rendered by the browser smoke test.',
  properties: {
    name: string,
    label: string,
    healthy: property(boolean, { required: false }),
  },
})

const RemoteMonitor = nodeClass({ properties: { label: string } })
const RemoteSchema = defineSchema('remote-e2e.astrale.ai', {
  classes: { RemoteMonitor },
})
const reportsTo = edgeClass.directed({
  source: { as: 'monitor', accepts: [Monitor], outgoing: '0..*' },
  target: { as: 'remote', accepts: [RemoteMonitor], incoming: '0..*' },
})

const primary = core.node(Monitor, {
  name: 'Primary monitor',
  label: 'Browser fixture',
  healthy: true,
})

export const StudioE2ESchema = defineSchema('studio-e2e.astrale.ai', {
  dependencies: { remote: RemoteSchema },
  classes: { Monitor, reportsTo },
  views: {
    overview: view({
      description: 'Fixture overview.',
      target: 'domain',
    }),
  },
  core: { nodes: { primary }, edges: [] },
})

export type StudioE2ESchema = typeof StudioE2ESchema
