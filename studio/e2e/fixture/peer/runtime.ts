import { defineRuntime } from '@astrale-os/sdk/runtime'

import type { StudioPeerE2ESchema } from './schema/index.js'

export const runtime = defineRuntime<StudioPeerE2ESchema>()({
  integrations: {},
  initialize: () => ({ providers: {} }),
  actions: [],
  workflows: [],
})

export default runtime
