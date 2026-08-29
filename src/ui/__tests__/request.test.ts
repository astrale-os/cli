import { describe, expect, test } from 'bun:test'

import { UiError } from '../model'
import {
  admitUiRequestResult,
  createUiRequestInput,
  requestUi,
  UI_REQUEST_LIMITS,
} from '../request'

describe('UI request contract', () => {
  test('normalizes intent and derives one deterministic bounded key', () => {
    const first = createUiRequestInput('  accessible\r\ncombobox  ')
    const replay = createUiRequestInput('accessible\ncombobox')

    expect(first).toEqual({
      intent: 'accessible\ncombobox',
      idempotencyKey: expect.stringMatching(/^ui-request:v1:[a-f0-9]{64}$/),
    })
    expect(replay).toEqual(first)
  })

  test('admits exact Unicode boundaries and rejects empty or oversized intent', () => {
    expect(
      createUiRequestInput('🪐'.repeat(UI_REQUEST_LIMITS.queryCodePoints)).intent,
    ).toHaveLength(UI_REQUEST_LIMITS.queryCodePoints * 2)
    for (const value of ['', '   ', '🪐'.repeat(513)]) {
      let failure: unknown
      try {
        createUiRequestInput(value)
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(UiError)
      expect((failure as UiError).code).toBe('UI_REQUEST_QUERY_INVALID')
    }
  })

  test('submits exactly the admitted input and returns the admitted receipt', async () => {
    let submitted: unknown
    const receipt = await requestUi('api status monitor', async (input) => {
      submitted = input
      return {
        state: 'submitted',
        requestId: 'request-1',
        collaborationUrl: 'https://github.com/astrale-os/ui/issues/68',
      }
    })

    expect(submitted).toEqual(createUiRequestInput('api status monitor'))
    expect(receipt).toEqual({
      state: 'submitted',
      requestId: 'request-1',
      collaborationUrl: 'https://github.com/astrale-os/ui/issues/68',
    })
  })

  test('admits every non-submitted Domain state', () => {
    for (const state of ['pending', 'outcome-unknown', 'failed', 'conflict'] as const) {
      expect(admitUiRequestResult({ state, requestId: 'request-1' })).toEqual({
        state,
        requestId: 'request-1',
      })
    }
  })

  test('rejects widened, malformed, and unsafe receipts', () => {
    const malformed = [
      undefined,
      { state: 'submitted', requestId: '' },
      { state: 'pending', requestId: 'request-1', extra: true },
      {
        state: 'submitted',
        requestId: 'request-1',
        collaborationUrl: 'javascript:alert(1)',
      },
      { state: 'unknown', requestId: 'request-1' },
    ]
    for (const value of malformed) expect(() => admitUiRequestResult(value)).toThrow(UiError)
  })
})
