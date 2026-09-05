import type { MountedWindow, ResolvedView } from '@astrale-os/shell'

import {
  createIframeShellAdapter,
  createShell,
  rejectIntent,
  replyToIntent,
} from '@astrale-os/shell'

import {
  installExternalOpenIntentHandler,
  openExternalBrowserWindow,
} from '../src/lib/view/external-open-intent'
import { viewHostCapabilities } from '../src/lib/view/host-capabilities'
import { installOpenIntentHandler } from '../src/lib/view/open-intent'
import { accessibleIframeAdapter, viewTitle } from './frame'
import { createViewTokenBroker, type ViewToken } from './token'

/**
 * The `astrale view` host page: a thin consumer of Shell's exact V2 mount
 * contract. Its nonce-scoped server supplies one target-bound Host placement;
 * this page never reconstructs parallel URL, target, key, or handshake inputs.
 */

type Config = {
  view: ResolvedView
  /** Direct kernel URL (public https) or the nonce-scoped local proxy. */
  kernelUrl: string
  kernelIssuer: ResolvedView['route']['issuer']
  identity: string | null
  instance: string | null
  sessionId: string
  externalOrigins: readonly string[]
  revision: number
}

const HEARTBEAT_MS = 1_000
const HANDSHAKE_TIMEOUT_MS = 10_000
const MAXIMUM_ROUTE_AGE_MS = 5 * 60_000
const base = location.pathname.replace(/\/+$/, '')
let revision: number | undefined

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
  })
    .then(async (response) => {
      if (!response.ok) return
      const next = (await response.json()) as { revision: number }
      if (revision !== undefined && next.revision !== revision) location.reload()
    })
    .catch(() => {})
}

function el(id: string): HTMLElement {
  return document.getElementById(id)!
}

function setStatus(state: string): void {
  el('status-dot').dataset.state = state
}

function fail(error: unknown): void {
  const message = errorMessage(error)
  setStatus('failed')
  const box = el('error')
  box.style.display = 'block'
  box.textContent = message
  report('failed', message)
}

function showIntentError(error: unknown): void {
  const box = el('error')
  box.style.display = 'block'
  box.textContent = errorMessage(error)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return String(error)
}

function showPlacement(view: ResolvedView): void {
  el('view-label').textContent = `/:${view.route.key}`
  el('target-label').textContent = view.target
  document.title = viewTitle(view.route.key)
}

async function main(): Promise<void> {
  const cfg = await j<Config>('/config.json')
  revision = cfg.revision
  const hostCapabilities = viewHostCapabilities(cfg.externalOrigins)
  const route = cfg.view.route
  showPlacement(cfg.view)
  el('identity-label').textContent = [cfg.identity, cfg.instance].filter(Boolean).join(' @ ')

  report('mounting')
  let tokens: ReturnType<typeof createViewTokenBroker> | null = null
  if (route.handshake === 'shell') {
    tokens = createViewTokenBroker(await j<ViewToken>('/token', { method: 'POST' }), () =>
      j<ViewToken>('/token', { method: 'POST' }),
    )
  }
  const kernelUrl = new URL(cfg.kernelUrl, location.href).href

  const shell = createShell({
    mode: 'standalone',
    session: {
      kernel: cfg.kernelIssuer,
      auth: {
        ttlSeconds: 3_600,
        resolve: () => (tokens === null ? {} : tokens.resolve()),
      },
      policy: {
        maximumRouteAgeMs: MAXIMUM_ROUTE_AGE_MS,
        ...(new URL(kernelUrl).protocol === 'http:' ? { allowInsecureHttp: true } : {}),
      },
      envelopeTransport: 'http',
    },
    adapter: accessibleIframeAdapter(createIframeShellAdapter()),
    // `astrale view` is explicit host approval of the exact installed route;
    // Shell has already rejected invalid or unsupported iframe requirements.
    iframePolicy: () => true,
  })
  await shell.init()

  const container = el('frame')
  let mounted: MountedWindow | null = null

  const mount = async (view: ResolvedView): Promise<MountedWindow> => {
    const credential =
      view.route.handshake === 'shell'
        ? {
            token: tokens!.current().token,
            expiresAt: tokens!.current().expiresAt,
            refresh: () => tokens!.refresh(),
          }
        : undefined
    return shell.openView({
      host: container,
      view,
      capabilities: hostCapabilities,
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
      showPlacement(selected)
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
  installExternalOpenIntentHandler(shell, {
    open: (request) => openExternalBrowserWindow(window, request),
  })

  // One placement means one mount attempt. Shell-handshake failures remain
  // failures; changing them to `none` would grant a different public contract.
  mounted = await mount(cfg.view)
  if (route.handshake === 'shell') {
    setStatus('connected')
    report('connected')
  } else {
    setStatus('plain')
    report('plain')
  }
  setInterval(() => report('alive'), HEARTBEAT_MS)
}

main().catch(fail)
