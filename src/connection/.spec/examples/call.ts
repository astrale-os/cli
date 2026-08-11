import { pathCall } from '@astrale-os/kernel-client'
import { Path } from '@astrale-os/kernel-core/path'

import { withHostSession } from '../api.js'

const result = await withHostSession({ instance: 'staging', as: 'alice' }, ({ host }) =>
  host.call(pathCall(Path.parse('/:notes.example.dev:function.search'), { text: 'astrale' })),
)

console.log(result)
