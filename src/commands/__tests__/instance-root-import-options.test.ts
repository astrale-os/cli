import { expect, test } from 'bun:test'
import { Command } from 'commander'

import { withKernelOptions } from '../../program/options'
import { registerCommand } from '../../program/registry'
import definition from '../instance/root/import'
test('root import admits an explicit Fleet together with the identity and recovery confirmation', async () => {
  const program = new Command().exitOverride()
  let received: unknown
  registerCommand(
    program,
    withKernelOptions({
      ...definition,
      action: async (instance: string, opts: unknown) => {
        received = { instance, opts }
      },
    }),
  )
  await program.parseAsync(['import', 'demo', '--fleet', '@fleet', '--as', 'operator', '--yes'], {
    from: 'user',
  })
  expect(received).toMatchObject({
    instance: 'demo',
    opts: { fleet: '@fleet', as: 'operator', yes: true },
  })
})
