import type { IrMethod } from '@shared/types'

import { describe, expect, test } from 'bun:test'
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

function render(overrides: Partial<IrMethod> = {}) {
  return renderToStaticMarkup(
    <CallableDetail bundle={bundle({})} owner="Integration" method={{ ...method, ...overrides }} />,
  )
}

describe('callable policy ownership', () => {
  test('explains where an abstract contract receives its policy', () => {
    const html = render()
    expect(html).toContain('Policy is declared on the implementation')
    expect(html).not.toContain('no Policy pinned')
  })

  test('shows the implementation policy instead of the contract notice', () => {
    const html = render({
      abstract: false,
      executable: true,
      policy: {
        check: { origin: 'local.example.dev', kind: 'policy', name: 'UseIntegration' },
        object: { kind: 'self' },
      },
    })
    expect(html).toContain('UseIntegration')
    expect(html).not.toContain('no Policy pinned')
    expect(html).not.toContain('Policy is declared on the implementation')
  })

  test('retains the missing policy notice for executable declarations, including abstract obligations', () => {
    for (const abstract of [true, false]) {
      const html = render({ abstract, executable: true })
      expect(html).toContain('no Policy pinned')
      expect(html).not.toContain('Policy is declared on the implementation')
    }
  })
})
