import { describe, expect, mock, test } from 'bun:test'

import type { ExternalOpenIntentMessage } from '../view/external-open-intent'

import {
  installExternalOpenIntentHandler,
  openExternalBrowserWindow,
} from '../view/external-open-intent'

describe('View external navigation host effect', () => {
  test('reports the physical browser outcome to the exact requesting child', () => {
    let handler: ((message: ExternalOpenIntentMessage) => void) | undefined
    const send = mock((_windowId: string, _message: unknown) => undefined)
    const shell = {
      children: { send },
      onIntent: (_name: string, value: typeof handler) => {
        handler = value
        return () => undefined
      },
    }
    installExternalOpenIntentHandler(shell as never, { open: () => true })

    handler?.(message())

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toBe('child-1')
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      envelope: {
        name: 'intentReply',
        payload: { correlationId: 'request-1', result: { outcome: 'opened' } },
      },
    })
  })

  test('severs the opener retained by a successful browser open', () => {
    const opened = { opener: {} }
    const open = mock(() => opened)

    expect(
      openExternalBrowserWindow({ open } as never, {
        url: 'https://connect.nango.dev/session',
        mode: 'popup',
      }),
    ).toBe(true)
    expect(opened.opener).toBeNull()
  })
})

function message(): ExternalOpenIntentMessage {
  return {
    type: 'intent',
    version: 1,
    envelope: {
      name: 'browser.openExternal',
      payload: { url: 'https://connect.nango.dev/session', mode: 'popup' },
      sender: { windowId: 'child-1' },
      correlationId: 'request-1',
    },
  }
}
