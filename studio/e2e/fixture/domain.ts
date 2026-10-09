import { defineDomain } from '@astrale-os/sdk/domain'

import { runtime } from './runtime.js'
import { StudioE2ESchema } from './schema/index.js'

export const domain = defineDomain({
  schema: StudioE2ESchema,
  runtime,
})

export default domain
