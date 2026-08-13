import type { MountedWindow, ResolvedView } from '@astrale-os/shell'

import {
  createIframeShellAdapter,
  createShell,
  rejectIntent,
  replyToIntent,
} from '@astrale-os/shell'

import { installOpenIntentHandler } from '../src/lib/view/open-intent'

/**
 * The `astrale view` host page: a thin consumer of Shell's exact V2 mount
 * contract. Its nonce-scoped server supplies one target-bound Host placement;
 * this page never reconstructs parallel URL, target, key, or handshake inputs.
 */

type Config = {
  view: ResolvedView
  /** Direct kernel URL (public https) or the nonce-scoped local proxy. */
  kernelUrl: string
  kernelIssuer: ResolvedView['placement']['issuer']
  identity: string | null
  instance: string | null
  sessionId: string
}

type Token = { token: string; expiresAt: number; kind: string }

const HEARTBEAT_MS = 5 * 60_000
const HANDSHAKE_TIMEOUT_MS = 10_000
const MAXIMUM_ROUTE_AGE_MS = 5 * 60_000

const base = location.pathname.replace(/\/+$/, '')

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, init)
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

function report(state: string, error?: string): void {
  void fetch(`${base}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, error }),
    keepalive: true,
  }).catch(() => {})
}

function el(id: string): HTMLElement {
  return document.getElementById(id)!
}

function setStatus(state: string): void {
  el('status-dot').dataset.state = state
}

function fail(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  setStatus('failed')
  const box = el('error')
  box.style.display = 'block'
  box.textContent = message
  report('failed', message)
}

function showIntentError(error: unknown): void {
  const box = el('error')
  box.style.display = 'block'
  box.textContent = error instanceof Error ? error.message : String(error)
}

async function main(): Promise<void> {
  const cfg = await j<Config>('/config.json')
  const placement = cfg.view.placement
  el('view-label').textContent = `/:${placement.key}`
  el('target-label').textContent = cfg.view.target
  el('identity-label').textContent = [cfg.identity, cfg.instance].filter(Boolean).join(' @ ')
  document.title = `astrale view — ${placement.key}`

  report('mounting')
  let current: Token | null = null
  if (placement.handshake === 'shell') {
    current = await j<Token>('/token', { method: 'POST' })
  }
  const kernelUrl = new URL(cfg.kernelUrl, location.href).href

  const shell = createShell({
    mode: 'standalone',
    session: {
      url: kernelUrl,
      sourceIssuer: cfg.kernelIssuer,
      auth: {
        ttlSeconds: 3_600,
        resolve: () => (current === null ? {} : { credential: current.token }),
      },
      policy: {
        maximumRouteAgeMs: MAXIMUM_ROUTE_AGE_MS,
        ...(new URL(kernelUrl).protocol === 'http:' ? { allowInsecureHttp: true } : {}),
      },
      envelopeTransport: 'http',
    },
    adapter: createIframeShellAdapter(),
  })
  await shell.init()

  const container = el('frame')
  let mounted: MountedWindow | null = null

  const mount = async (view: ResolvedView): Promise<MountedWindow> => {
    const credential =
      view.placement.handshake === 'shell'
        ? {
            token: current!.token,
            expiresAt: current!.expiresAt,
            refresh: async () => {
              current = await j<Token>('/token', { method: 'POST' })
              return { token: current.token, expiresAt: current.expiresAt }
            },
          }
        : undefined
    return shell.mount({
      host: container,
      view,
      capabilities: { intents: ['open', 'receive', 'closeAck', 'closeRefuse'] },
      sandbox: null,
      handshakeTimeoutMs: HANDSHAKE_TIMEOUT_MS,
      ...(credential === undefined ? {} : { credential }),
    })
  }

  installOpenIntentHandler(shell, {
    current: () => mounted,
    setCurrent: (next) => {
      mounted = next
    },
    mount,
    opened: (selected) => {
      el('view-label').textContent = `/:${selected.placement.key}`
      el('target-label').textContent = selected.target
      el('error').style.display = 'none'
    },
    failed: showIntentError,
    reply: (message, windowId) => {
      replyToIntent(shell.children, message.envelope.sender.windowId, message, { windowId })
    },
    reject: (message, error) => {
      rejectIntent(shell.children, message.envelope.sender.windowId, message, error)
    },
  })

  // One placement means one mount attempt. Shell-handshake failures remain
  // failures; changing them to `none` would grant a different public contract.
  mounted = await mount(cfg.view)
  if (placement.handshake === 'shell') {
    setStatus('connected')
    report('connected')
  } else {
    setStatus('plain')
    report('plain')
  }
  setInterval(() => report('alive'), HEARTBEAT_MS)
}

main().catch(fail)
