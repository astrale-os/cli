import { defineDomain } from '@astrale-os/sdk/domain'

import { runtime } from './runtime.js'
import { StudioPeerE2ESchema } from './schema/index.js'

export const domain = defineDomain({ schema: StudioPeerE2ESchema, runtime })

export default domain
