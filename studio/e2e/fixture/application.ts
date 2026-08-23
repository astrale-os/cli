import { defineApplication } from '@astrale-os/sdk/application'

import { runtime } from './runtime.js'
import { StudioE2ESchema } from './schema/index.js'

export const application = defineApplication({
  schema: StudioE2ESchema,
  runtime,
})

export default application
