import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { promptText } from '../prompt'

// The no-TTY branch IS the LLM / CI / piped case. promptText must resolve to a
// default (never await a stdin read) there, so `astrale domain publish` fails
// fast on its required-flag error instead of hanging. Force isTTY=false so this
// holds even when the suite is run from an interactive terminal.
describe('promptText — non-TTY never blocks on input', () => {
  const original = process.stdin.isTTY
  beforeAll(() => {
    ;(process.stdin as { isTTY?: boolean }).isTTY = false
  })
  afterAll(() => {
    ;(process.stdin as { isTTY?: boolean }).isTTY = original
  })

  test('returns the provided default', async () => {
    expect(await promptText('Domain origin', { default: 'crm.acme.dev' })).toBe('crm.acme.dev')
  })

  test('returns undefined with no default (caller then hits its required-flag error)', async () => {
    expect(await promptText('Published worker URL')).toBeUndefined()
  })
})
