import type { ChildrenChannel, ExternalOpenRequest, Shell } from '@astrale-os/shell'

import { capabilitiesMiddleware, createIntentPipeline, createIntentRouter } from '@astrale-os/shell'
import { describe, expect, mock, test } from 'bun:test'

import type { ExternalOpenIntentMessage } from '../view/external-open-intent'

import {
  installExternalOpenIntentHandler,
  openExternalBrowserWindow,
} from '../view/external-open-intent'
import { viewHostCapabilities } from '../view/host-capabilities'

describe('View external navigation host effect', () => {
  test('the real Shell pipeline opens only an exact granted origin and replies to the physical child', async () => {
    const sent: Array<{ windowId: string; message: unknown }> = []
    const children = {
      send: (windowId: string, value: unknown) => sent.push({ windowId, message: value }),
      has: () => true,
      on: () => () => undefined,
      onClose: () => () => undefined,
    } as ChildrenChannel
    const capabilities = viewHostCapabilities(['https://connect.nango.dev'])
    const pipeline = createIntentPipeline()
    pipeline.use(
      capabilitiesMiddleware({
        lookup: (sender) => (sender === 'physical-child' ? capabilities : undefined),
      }),
    )
    const router = createIntentRouter({
      selfWindowId: 'root',
      pipeline,
      parent: null,
      children,
    })
    const open = mock((_request: ExternalOpenRequest) => true)
    installExternalOpenIntentHandler(
      {
        children,
        onIntent: router.onLocal.bind(router),
      } as unknown as Shell,
      { open },
    )

    await router.handleInbound(
      'child',
      message('https://connect.nango.dev/session', 'forged-sibling'),
      'physical-child',
    )

    expect(open).toHaveBeenCalledTimes(1)
    expect(sent).toEqual([
      {
        windowId: 'physical-child',
        message: expect.objectContaining({
          envelope: expect.objectContaining({
            payload: { correlationId: 'request-1', result: { outcome: 'opened' } },
          }),
        }),
      },
    ])

    for (const denied of [
      'http://connect.nango.dev/session',
      'https://sub.connect.nango.dev/session',
      'https://connect.nango.dev:444/session',
      'https://evil.example/session',
    ]) {
      await router.handleInbound('child', message(denied), 'physical-child')
    }
    await router.handleInbound('child', message('https://connect.nango.dev/session'), 'ungranted')
    expect(open).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(1)
  })

  test('reports a popup block through the admitted pipeline', async () => {
    const sent = mock((_windowId: string, _message: unknown) => undefined)
    const children = {
      send: sent,
      has: () => true,
      on: () => () => undefined,
      onClose: () => () => undefined,
    } as ChildrenChannel
    const pipeline = createIntentPipeline()
    pipeline.use(
      capabilitiesMiddleware({
        lookup: () => viewHostCapabilities(['https://connect.nango.dev']),
      }),
    )
    const router = createIntentRouter({ selfWindowId: 'root', pipeline, parent: null, children })
    installExternalOpenIntentHandler(
      { children, onIntent: router.onLocal.bind(router) } as unknown as Shell,
      { open: () => false },
    )

    await router.handleInbound('child', message('https://connect.nango.dev/session'), 'child-1')

    expect(sent).toHaveBeenCalledWith(
      'child-1',
      expect.objectContaining({
        envelope: expect.objectContaining({
          payload: { correlationId: 'request-1', result: { outcome: 'blocked' } },
        }),
      }),
    )
  })

  test('isolates a fresh inert context before navigating and closes it when isolation fails', () => {
    const replace = mock((_url: string) => undefined)
    const opened = { opener: {}, location: { replace }, close: mock(() => undefined) }
    const open = mock(() => opened)

    expect(
      openExternalBrowserWindow({ open } as never, {
        url: 'https://connect.nango.dev/session',
        mode: 'popup',
      }),
    ).toBe(true)
    expect(open).toHaveBeenCalledWith('', '_blank', 'popup,width=720,height=760')
    expect(opened.opener).toBeNull()
    expect(replace).toHaveBeenCalledWith('https://connect.nango.dev/session')

    const close = mock(() => undefined)
    const unsafe = Object.defineProperty({ close, location: { replace: mock() } }, 'opener', {
      set: () => {
        throw new Error('opener isolation refused')
      },
    })
    expect(
      openExternalBrowserWindow({ open: () => unsafe } as never, {
        url: 'https://connect.nango.dev/session',
        mode: 'tab',
      }),
    ).toBe(false)
    expect(close).toHaveBeenCalledTimes(1)
  })
})

function message(url: string, sender = 'child-1'): ExternalOpenIntentMessage {
  return {
    type: 'intent',
    version: 1,
    envelope: {
      name: 'browser.openExternal',
      payload: { url, mode: 'popup' },
      sender: { windowId: sender },
      correlationId: 'request-1',
    },
  }
}
