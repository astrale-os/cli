import { defineApplication } from '@astrale-os/sdk/application'

import { runtime } from './runtime.js'
import { StudioPeerE2ESchema } from './schema/index.js'

export const application = defineApplication({ schema: StudioPeerE2ESchema, runtime })

export default application
