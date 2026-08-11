import { createPathCall, withHostSession } from '../api.js'

const result = await withHostSession({ instance: 'staging', as: 'alice' }, ({ host }) =>
  host.call(createPathCall('/:notes.example.dev:function.search', { text: 'astrale' })),
)

console.log(result)
