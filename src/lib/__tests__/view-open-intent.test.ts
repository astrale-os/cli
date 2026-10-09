import type { IntentMessage, MountedWindow, ResolvedView, Shell } from '@astrale-os/shell'

import { NO_HOST_CAPABILITIES } from '@astrale-os/shell'
import { describe, expect, test } from 'bun:test'

import {
  domainViewPath,
  handleViewOpenIntent,
  installViewOpenHandler,
  type ViewOpenHost,
} from '../view/open-intent'

const digest = (character: string) => `sha256:${character.repeat(64)}` as const
const target = (value: string) => value as ResolvedView['target']
const issuer = (value: string) => value as ResolvedView['route']['issuer']
const revision = (character: string) => digest(character) as ResolvedView['route']['revision']

function domainView(name: string): ResolvedView {
  return {
    target: target('/:shell.test'),
    route: {
      key: `shell.test:view.${name}` as ResolvedView['route']['key'],
      declaration: { target: { kind: 'domain' } },
      href: `https://shell.test/${name}`,
      handshake: 'shell',
      issuer: issuer('https://shell.test'),
      release: digest('a'),
      revision: revision('b'),
    },
  }
}

function openMessage(view: string, correlationId?: string): IntentMessage<'view.open'> {
  return {
    type: 'intent',
    version: 1,
    envelope: {
      name: 'view.open',
      payload: {
        view: view as IntentMessage<'view.open'>['envelope']['payload']['view'],
      },
      sender: { windowId: 'old-window' },
      ...(correlationId ? { correlationId } : {}),
    },
  }
}

function mounted(windowId: string, view: ResolvedView, onClose?: () => void): MountedWindow {
  return {
    windowId,
    window: {
      windowId,
      functionId: String(view.route.key),
      children: [],
      view,
      location: { target: view.target, params: {} },
      presentation: { kind: 'inline', constrained: false },
      isolation: 'shared',
      state: 'ready',
      credential: { state: 'none' },
      capabilities: NO_HOST_CAPABILITIES,
    },
    view,
    handle: { element: {} as HTMLElement },
    credential: { state: 'none' },
    presentation: { kind: 'inline', constrained: false },
    ready: Promise.resolve(),
    focus() {},
    close: async () => {
      onClose?.()
      return { kind: 'closed' }
    },
    onNavigate: () => () => undefined,
    traverse: async () => {
      throw new Error('This View keeps no history to move.')
    },
  }
}

function harness() {
  const events: string[] = []
  const replies: { windowId: string; result: unknown }[] = []
  const old = mounted('old-window', domainView('home'), () => events.push('close:old-window'))
  let current: MountedWindow | null = old
  const host: ViewOpenHost = {
    current: () => current,
    setCurrent: (next) => {
      events.push(`current:${next.windowId}`)
      current = next
    },
    open: async (path) => {
      events.push(`open:${path}`)
      return mounted('new-window', domainView(path.slice(path.lastIndexOf('.') + 1)))
    },
    opened: (next) => events.push(`opened:${next.view.route.key}:${next.view.target}`),
    failed: (error) => events.push(`failed:${error instanceof Error ? error.message : error}`),
    reply: (message, result) => {
      if (!message.envelope.correlationId) return
      events.push(`reply:${message.envelope.sender.windowId}`)
      replies.push({ windowId: message.envelope.sender.windowId, result })
    },
    reject: (message, error) => {
      if (!message.envelope.correlationId) return
      events.push(`reject:${message.envelope.sender.windowId}`)
      replies.push({
        windowId: message.envelope.sender.windowId,
        result: { error: error instanceof Error ? error.message : String(error) },
      })
    },
  }
  return { events, replies, host, current: () => current }
}

describe('view.open host', () => {
  /** @evidence TEST-CLI-VIEW-OPEN-PRESERVES-RESOLVED-SELECTION */
  test('opens the View on its Domain and replies before retiring the requester', async () => {
    const h = harness()
    await handleViewOpenIntent(h.host, openMessage('shell.test:view.card', 'corr-1'))

    expect(h.events).toEqual([
      'open:/:shell.test:view.card',
      'current:new-window',
      'opened:shell.test:view.card:/:shell.test',
      'reply:old-window',
      'close:old-window',
    ])
    expect(h.current()?.windowId).toBe('new-window')
    expect(h.replies).toEqual([
      { windowId: 'old-window', result: { windowId: 'new-window', presentation: 'inline' } },
    ])
  })

  test('refuses to open a View for a node and keeps the current View', async () => {
    const h = harness()
    await handleViewOpenIntent(h.host, openMessage('@person-1', 'corr-node'))

    expect(h.current()?.windowId).toBe('old-window')
    expect(h.events).toEqual([
      'reject:old-window',
      expect.stringContaining('failed:Invalid View key'),
    ])
  })

  /** @evidence TEST-CLI-VIEW-HANDSHAKE-FAILS-CLOSED */
  test('makes one replacement attempt and keeps the current View when it fails', async () => {
    const h = harness()
    let attempts = 0
    h.host.open = async () => {
      attempts++
      throw new Error('handshake failed')
    }

    await handleViewOpenIntent(h.host, openMessage('shell.test:view.card', 'corr-mount'))

    expect(attempts).toBe(1)
    expect(h.current()?.windowId).toBe('old-window')
    expect(h.events).toEqual(['reject:old-window', 'failed:handshake failed'])
  })

  test('serializes overlapping opens', async () => {
    let handler: ((message: IntentMessage<'view.open'>) => Promise<void>) | undefined
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let opens = 0
    const base = harness()
    const events = base.events
    const shell = {
      onIntent: (_name: 'view.open', next: typeof handler) => {
        handler = next
        return () => {}
      },
    } as unknown as Pick<Shell, 'onIntent'>
    const host: ViewOpenHost = {
      ...base.host,
      open: async () => {
        opens += 1
        const id = `new-${opens}`
        events.push(`open:${id}`)
        if (opens === 1) await firstGate
        return mounted(id, domainView('card'), () => events.push(`close:${id}`))
      },
    }
    installViewOpenHandler(shell, host)

    const first = handler!(openMessage('shell.test:view.card'))
    const second = handler!(openMessage('shell.test:view.card'))
    await Promise.resolve()
    expect(events).toEqual(['open:new-1'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual([
      'open:new-1',
      'current:new-1',
      'opened:shell.test:view.card:/:shell.test',
      'close:old-window',
      'open:new-2',
      'current:new-2',
      'opened:shell.test:view.card:/:shell.test',
      'close:new-1',
    ])
    expect(base.current()?.windowId).toBe('new-2')
  })
})

describe('domainViewPath', () => {
  test('maps a View key to its declaration path', () => {
    expect(domainViewPath({ view: 'crm.example:view.dashboard' })).toBe(
      '/:crm.example:view.dashboard',
    )
  })

  test('refuses a malformed key', () => {
    expect(() => domainViewPath({ view: 'crm.example' })).toThrow('Invalid View key')
  })
})
