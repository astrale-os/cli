import type { IntentMessage, MountedWindow, ResolvedView, Shell } from '@astrale-os/shell'

import { describe, expect, test } from 'bun:test'

import {
  handleOpenIntent,
  installOpenIntentHandler,
  mountWithHandshakeFallback,
  type OpenIntentHost,
} from '../view/open-intent'

const profile: ResolvedView = {
  id: 'profile-view',
  path: '/shell/views/profile',
  url: 'https://shell.test/profile',
  origin: 'class',
}
const card: ResolvedView = {
  id: 'card-view',
  path: '/shell/views/card',
  url: 'https://shell.test/card',
  handshake: 'none',
  origin: 'class',
}

function openMessage(viewId?: string, correlationId?: string): IntentMessage<'open'> {
  return {
    type: 'intent',
    version: 1,
    envelope: {
      name: 'open',
      payload: { nodeId: 'person-1', ...(viewId ? { viewId } : {}) },
      sender: { windowId: 'old-window' },
      ...(correlationId ? { correlationId } : {}),
    },
  }
}

function mounted(windowId: string, onClose?: () => void): MountedWindow {
  return {
    windowId,
    window: {
      windowId,
      functionId: 'view',
      isolation: 'shared',
      state: 'active',
      delegationToken: null,
      capabilities: { intents: [] },
    },
    handle: { element: {} as HTMLElement },
    close: async () => {
      onClose?.()
      return { kind: 'closed' }
    },
  }
}

function harness(views: readonly ResolvedView[] = [profile, card]) {
  const events: string[] = []
  const sent: { windowId: string; message: IntentMessage }[] = []
  const old = mounted('old-window', () => events.push('close:old-window'))
  let current: MountedWindow | null = old
  const shell = {
    views: {
      resolve: async (node: string) => {
        events.push(`resolve:${node}`)
        return views
      },
    },
    children: {
      send: (windowId: string, message: IntentMessage) => {
        events.push(`reply:${windowId}`)
        sent.push({ windowId, message })
      },
    },
  } as unknown as Pick<Shell, 'children' | 'views'>
  const host: OpenIntentHost = {
    current: () => current,
    setCurrent: (next) => {
      events.push(`current:${next.windowId}`)
      current = next
    },
    mount: async (view, nodeId) => {
      events.push(`mount:${view.id}:${nodeId}`)
      return mounted('new-window')
    },
    opened: (view, nodeId) => events.push(`opened:${view.path}:${nodeId}`),
    failed: (error) => events.push(`failed:${error instanceof Error ? error.message : error}`),
  }
  return { events, sent, shell, host, current: () => current }
}

describe('open intent host', () => {
  test('uses kernel preference and replies before retiring the requesting child', async () => {
    const h = harness()
    await handleOpenIntent(h.shell, h.host, openMessage(undefined, 'corr-1'))

    expect(h.events).toEqual([
      'resolve:person-1',
      'mount:profile-view:person-1',
      'current:new-window',
      'opened:/shell/views/profile:person-1',
      'reply:old-window',
      'close:old-window',
    ])
    expect(h.current()?.windowId).toBe('new-window')
    expect(h.sent).toEqual([
      {
        windowId: 'old-window',
        message: {
          type: 'intent',
          version: 1,
          envelope: {
            name: 'intentReply',
            payload: { correlationId: 'corr-1', result: { windowId: 'new-window' } },
            sender: { windowId: 'root' },
          },
        },
      },
    ])
  })

  test('honors an explicit view and keeps fire-and-forget navigation reply-free', async () => {
    const h = harness()
    await handleOpenIntent(h.shell, h.host, openMessage('card-view'))

    expect(h.events).toContain('mount:card-view:person-1')
    expect(h.sent).toEqual([])
  })

  test('keeps the current view and rejects a correlated resolution failure', async () => {
    const h = harness([])
    await handleOpenIntent(h.shell, h.host, openMessage(undefined, 'corr-fail'))

    expect(h.current()?.windowId).toBe('old-window')
    expect(h.events).toEqual([
      'resolve:person-1',
      'reply:old-window',
      'failed:No view resolves for this node',
    ])
    expect(h.sent[0]!.message.envelope).toEqual({
      name: 'intentReply',
      payload: {
        correlationId: 'corr-fail',
        error: { message: 'No view resolves for this node' },
      },
      sender: { windowId: 'root' },
    })
  })

  test('keeps the current view when the replacement mount fails', async () => {
    const h = harness([profile])
    h.host.mount = async () => {
      h.events.push('mount:failed')
      throw new Error('replacement failed')
    }

    await handleOpenIntent(h.shell, h.host, openMessage(undefined, 'corr-mount'))

    expect(h.current()?.windowId).toBe('old-window')
    expect(h.events).toEqual([
      'resolve:person-1',
      'mount:failed',
      'reply:old-window',
      'failed:replacement failed',
    ])
    expect(h.sent[0]!.message.envelope.payload).toEqual({
      correlationId: 'corr-mount',
      error: { message: 'replacement failed' },
    })
  })

  test('serializes overlapping opens', async () => {
    let handler: ((message: IntentMessage<'open'>) => Promise<void>) | undefined
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let resolveCount = 0
    const base = harness([profile])
    const events = base.events
    const shell = {
      ...base.shell,
      views: {
        resolve: async () => {
          resolveCount += 1
          events.push(`resolve:${resolveCount}`)
          if (resolveCount === 1) await firstGate
          return [profile]
        },
      },
      onIntent: (_name: 'open', next: typeof handler) => {
        handler = next
        return () => {}
      },
    } as unknown as Shell
    const host = {
      ...base.host,
      mount: async () => {
        const id = `new-${resolveCount}`
        events.push(`mount:${id}`)
        return mounted(id, () => events.push(`close:${id}`))
      },
    }
    installOpenIntentHandler(shell, host)

    const first = handler!(openMessage())
    const second = handler!(openMessage())
    await Promise.resolve()
    expect(events).toEqual(['resolve:1'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual([
      'resolve:1',
      'mount:new-1',
      'current:new-1',
      'opened:/shell/views/profile:person-1',
      'close:old-window',
      'resolve:2',
      'mount:new-2',
      'current:new-2',
      'opened:/shell/views/profile:person-1',
      'close:new-1',
    ])
    expect(base.current()?.windowId).toBe('new-2')
  })
})

describe('mountWithHandshakeFallback', () => {
  test('mounts a plain view once', async () => {
    const attempts: string[] = []
    const result = await mountWithHandshakeFallback({
      handshake: 'none',
      attempts: 2,
      mount: async (handshake) => {
        attempts.push(handshake)
        return 'plain-window'
      },
      cleanupFailedAttempt: () => attempts.push('cleanup'),
    })
    expect(result).toEqual({ mounted: 'plain-window', handshake: 'none' })
    expect(attempts).toEqual(['none'])
  })

  test('retries shell mounts, cleans each failure, then falls back to plain', async () => {
    const attempts: string[] = []
    const result = await mountWithHandshakeFallback({
      handshake: 'shell',
      attempts: 2,
      mount: async (handshake) => {
        attempts.push(handshake)
        if (handshake === 'shell') throw new Error('handshake failed')
        return 'plain-window'
      },
      cleanupFailedAttempt: () => attempts.push('cleanup'),
    })
    expect(result).toEqual({ mounted: 'plain-window', handshake: 'none' })
    expect(attempts).toEqual(['shell', 'cleanup', 'shell', 'cleanup', 'none'])
  })

  test('cleans and surfaces the decisive plain fallback failure', async () => {
    const attempts: string[] = []
    const run = mountWithHandshakeFallback({
      handshake: 'shell',
      attempts: 2,
      mount: async (handshake) => {
        attempts.push(handshake)
        throw new Error(handshake === 'shell' ? 'handshake failed' : 'plain failed')
      },
      cleanupFailedAttempt: () => attempts.push('cleanup'),
    })

    await expect(run).rejects.toThrow('plain failed')
    expect(attempts).toEqual(['shell', 'cleanup', 'shell', 'cleanup', 'none', 'cleanup'])
  })
})
