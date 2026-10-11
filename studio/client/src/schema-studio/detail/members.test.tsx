import type { IrMethod } from '@shared/contracts/schema'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { bundle } from '../__tests__/fixture'
import { CallableDetail } from './members'

const method: IrMethod = {
  name: 'startConnection',
  input: { type: 'object' },
  output: { mode: 'value', schema: { type: 'boolean' } },
  auth: 'authorized',
  static: false,
  abstract: true,
  executable: false,
}

const render = (overrides: Partial<IrMethod>) =>
  renderToStaticMarkup(
    <CallableDetail bundle={bundle({})} owner="Integration" method={{ ...method, ...overrides }} />,
  )

test('a contract defers its Policy to the implementation; an executable without one says so', () => {
  expect(render({})).toContain('Policy is declared on the implementation')
  for (const abstract of [true, false])
    expect(render({ abstract, executable: true })).toContain('no Policy pinned')
  const pinned = render({
    abstract: false,
    executable: true,
    policy: {
      check: { origin: 'local.example.dev', kind: 'policy', name: 'UseIntegration' },
      object: { kind: 'self' },
    },
  })
  expect(pinned).toContain('UseIntegration')
  expect(pinned).not.toContain('no Policy pinned')
})
