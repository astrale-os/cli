import { expect, test } from 'bun:test'

import { parseDotenvPreview } from './dotenv-preview'

test('environment preview mirrors the SDK declared-secrets subset without mutating process.env', () => {
  const keys = ['BASE', 'EXPANDED', 'LITERAL', 'EMPTY'] as const
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  const seeded = {
    BASE: 'process-base',
    EXPANDED: 'process-expanded',
    LITERAL: 'process-literal',
    EMPTY: 'process-empty',
  } as const
  Object.assign(process.env, seeded)

  try {
    const values = parseDotenvPreview(`
BASE=alpha
EXPANDED="${'${BASE}'}/beta"
LITERAL='${'${BASE}'}/beta'
export EMPTY=
# IGNORED=value
`)

    expect(values).toEqual({
      BASE: 'alpha',
      EXPANDED: 'alpha/beta',
      LITERAL: '${BASE}/beta',
      EMPTY: '',
    })
    expect(Object.fromEntries(keys.map((key) => [key, process.env[key]]))).toEqual(seeded)
  } finally {
    for (const key of keys) {
      const value = before[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
