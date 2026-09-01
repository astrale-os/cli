import { defineRuntime } from '@astrale-os/sdk/runtime'

import type { StudioE2ESchema } from './schema/index.js'

export const runtime = defineRuntime<StudioE2ESchema>()({
  integrations: {},
  initialize: () => ({ providers: {} }),
  functions: [],
})

export default runtime
