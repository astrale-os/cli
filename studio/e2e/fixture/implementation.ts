import { defineDomain } from '@astrale-os/sdk'

import { schema } from './schema/index.js'

export const domain = defineDomain({
  schema,
  handlers: { functions: {}, classes: {}, interfaces: {} },
})
