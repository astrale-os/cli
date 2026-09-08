import { mock } from 'bun:test'

import * as connection from '../../../../connection/index'

// Keep module replacement in a subprocess; key loading and command dispatch are real.
const intents: unknown[] = []
mock.module('../../../../connection/index', () => ({
  ...connection,
  async runKernelCommand(input: Parameters<typeof connection.runKernelCommand>[0]) {
    intents.push(input.credential ?? null)
  },
}))
const { default: command } = await import('../../register')
await command.action('alice', {
  node: '@existing-user',
  json: true,
  via: '/:registration.example:function.registerIdentity',
})
await command.action('alice', { node: '@existing-user', json: true })
console.log(JSON.stringify(intents))
