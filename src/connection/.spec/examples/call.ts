import { createPathCall, withClientSession } from '../api.js'

const result = await withClientSession({ instance: 'staging', as: 'alice' }, ({ session }) =>
  session.call(createPathCall('/:notes.example.dev:function.search', { text: 'astrale' })),
)

console.log(result)
