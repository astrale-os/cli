import type { IntentMessage, MountedWindow, ResolvedView, Shell } from '@astrale-os/shell'

import { describe, expect, test } from 'bun:test'

import {
  handleOpenIntent,
  installOpenIntentHandler,
  type OpenIntentHost,
} from '../view/open-intent'

const digest = (character: string) => `sha256:${character.repeat(64)}` as const
const target = (value: string) => value as ResolvedView['target']
const issuer = (value: string) => value as ResolvedView['placement']['issuer']
const revision = (character: string) => digest(character) as ResolvedView['placement']['revision']

const profile: ResolvedView = {
  target: target('@person-1'),
  placement: {
    key: 'shell.test:view.profile',
    declaration: {
      target: {
        kind: 'definition',
        definitions: [{ origin: 'shell.test', kind: 'class', name: 'Person' }],
      },
      auth: 'required',
    },
    href: 'https://shell.test/profile',
    handshake: 'shell',
    issuer: issuer('https://shell.test'),
    etag: digest('a'),
    revision: revision('b'),
  },
}
const card: ResolvedView = {
  target: target('@person-1'),
  placement: {
    key: 'shell.test:view.card',
    declaration: {
      target: {
        kind: 'definition',
        definitions: [{ origin: 'shell.test', kind: 'class', name: 'Person' }],
      },
      auth: 'public',
    },
    href: 'https://shell.test/card',
    handshake: 'none',
    issuer: issuer('https://shell.test'),
    etag: digest('c'),
    revision: revision('d'),
  },
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
      functionId: 'shell.test:view.profile',
      targetNodeId: '@person-1',
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
  } as unknown as Pick<Shell, 'views'>
  const host: OpenIntentHost = {
    current: () => current,
    setCurrent: (next) => {
      events.push(`current:${next.windowId}`)
      current = next
    },
    mount: async (view) => {
      events.push(`mount:${view.placement.key}:${view.target}`)
      return mounted('new-window')
    },
    opened: (view) => events.push(`opened:${view.placement.key}:${view.target}`),
    failed: (error) => events.push(`failed:${error instanceof Error ? error.message : error}`),
    reply: (message, windowId) => {
      if (!message.envelope.correlationId) return
      events.push(`reply:${message.envelope.sender.windowId}`)
      sent.push({
        windowId: message.envelope.sender.windowId,
        message: {
          type: 'intent',
          version: 1,
          envelope: {
            name: 'intentReply',
            payload: {
              correlationId: message.envelope.correlationId,
              result: { windowId },
            },
            sender: { windowId: 'root' },
          },
        },
      })
    },
    reject: (message, error) => {
      if (!message.envelope.correlationId) return
      events.push(`reply:${message.envelope.sender.windowId}`)
      sent.push({
        windowId: message.envelope.sender.windowId,
        message: {
          type: 'intent',
          version: 1,
          envelope: {
            name: 'intentReply',
            payload: {
              correlationId: message.envelope.correlationId,
              error: { message: error instanceof Error ? error.message : String(error) },
            },
            sender: { windowId: 'root' },
          },
        },
      })
    },
  }
  return { events, sent, shell, host, current: () => current }
}

describe('open intent host', () => {
  /** @evidence TEST-CLI-VIEW-OPEN-PRESERVES-RESOLVED-SELECTION */
  test('uses the complete resolved placement and replies before retiring the requester', async () => {
    const h = harness()
    await handleOpenIntent(h.shell, h.host, openMessage(undefined, 'corr-1'))

    expect(h.events).toEqual([
      'resolve:person-1',
      'mount:shell.test:view.profile:@person-1',
      'current:new-window',
      'opened:shell.test:view.profile:@person-1',
      'reply:old-window',
      'close:old-window',
    ])
    expect(h.current()?.windowId).toBe('new-window')
    expect(h.sent[0]).toMatchObject({
      windowId: 'old-window',
      message: {
        envelope: {
          payload: { correlationId: 'corr-1', result: { windowId: 'new-window' } },
        },
      },
    })
  })

  test('selects an explicit canonical View key without flattening its placement', async () => {
    const h = harness()
    await handleOpenIntent(h.shell, h.host, openMessage('shell.test:view.card'))

    expect(h.events).toContain('mount:shell.test:view.card:@person-1')
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
  })

  /** @evidence TEST-CLI-VIEW-HANDSHAKE-FAILS-CLOSED */
  test('makes one replacement mount attempt and never retries as a different placement mode', async () => {
    const h = harness([profile])
    let attempts = 0
    h.host.mount = async (view) => {
      attempts++
      h.events.push(`mount:${view.placement.handshake}:failed`)
      throw new Error('handshake failed')
    }

    await handleOpenIntent(h.shell, h.host, openMessage(undefined, 'corr-mount'))

    expect(attempts).toBe(1)
    expect(h.current()?.windowId).toBe('old-window')
    expect(h.events).toEqual([
      'resolve:person-1',
      'mount:shell:failed',
      'reply:old-window',
      'failed:handshake failed',
    ])
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
      'opened:shell.test:view.profile:@person-1',
      'close:old-window',
      'resolve:2',
      'mount:new-2',
      'current:new-2',
      'opened:shell.test:view.profile:@person-1',
      'close:new-1',
    ])
    expect(base.current()?.windowId).toBe('new-2')
  })
})
