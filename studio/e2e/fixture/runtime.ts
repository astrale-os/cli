import { defineRuntime } from '@astrale-os/sdk/runtime'

import type { StudioE2ESchema } from './schema/index.js'

import { reconcile, settle } from './actions/invoice.js'
import { Ledger } from './integrations/ledger.js'

// Read statically by Studio (Behavior lens); it is never deployed.
export const runtime = defineRuntime<StudioE2ESchema>()({
  integrations: { ledger: Ledger },
  initialize: () => ({ providers: {} }),
  functions: [settle, reconcile],
})

export default runtime
