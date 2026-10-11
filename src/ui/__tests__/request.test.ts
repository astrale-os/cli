import { describe, expect, test } from 'bun:test'

import { requestUi } from '../request'

const submitted = {
  state: 'submitted',
  requestId: 'request-1',
  collaborationUrl: 'https://github.com/astrale-os/ui/issues/68',
} as const

describe('UI request', () => {
  test('submits one normalized intent under a deterministic key and returns the exact receipt', async () => {
    const inputs: unknown[] = []
    const submit = async (input: unknown) => {
      inputs.push(input)
      return submitted
    }

    expect(await requestUi('  accessible\r\ncombobox  ', submit)).toEqual(submitted)
    await requestUi('accessible\ncombobox', submit)
    expect(inputs[0]).toEqual({
      intent: 'accessible\ncombobox',
      idempotencyKey: expect.stringMatching(/^ui-request:v1:[a-f0-9]{64}$/),
    })
    expect(inputs[1]).toEqual(inputs[0])
    for (const state of ['pending', 'outcome-unknown', 'failed', 'conflict'] as const) {
      expect(await requestUi('x', async () => ({ state, requestId: 'r' }))).toEqual({
        state,
        requestId: 'r',
      })
    }
  })

  test('refuses an empty or oversized intent and any widened or unsafe receipt', async () => {
    for (const intent of ['   ', '🪐'.repeat(513)]) {
      await expect(requestUi(intent, async () => submitted)).rejects.toMatchObject({
        code: 'UI_REQUEST_QUERY_INVALID',
      })
    }
    for (const receipt of [
      undefined,
      { state: 'pending', requestId: 'r', extra: true },
      { ...submitted, collaborationUrl: 'javascript:alert(1)' },
      { state: 'unknown', requestId: 'r' },
    ]) {
      await expect(requestUi('x', async () => receipt)).rejects.toMatchObject({
        code: 'UI_REQUEST_UNAVAILABLE',
      })
    }
  })
})
