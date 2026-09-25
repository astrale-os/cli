import type { MountedWindow, ResolvedView } from '@astrale-os/shell'

import { createSessionCredentialProvider } from '@astrale-os/sdk/client/session'
import {
  createIframeShellAdapter,
  createShell,
  openExternalBrowserWindow,
  rejectIntent,
  replyToIntent,
} from '@astrale-os/shell'

import { viewHostCapabilities } from '../src/lib/view/host-capabilities'
import { installOpenIntentHandler } from '../src/lib/view/open-intent'
import { accessibleIframeAdapter, viewTitle } from './frame'

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
  /** Delegation every View call must be able to make; the credential threshold derives from it. */
  delegationTtlSeconds: number
  revision: number
  identities?: readonly string[]
}

const HEARTBEAT_MS = 1_000
const HANDSHAKE_TIMEOUT_MS = 10_000
const MAXIMUM_ROUTE_AGE_MS = 5 * 60_000
const base = location.pathname.replace(/\/+$/, '')
/**
 * This page's hold on the session. The server keeps a session up while any page
 * holds one, so the host that opened this page may name the hold it is going to
 * hand back (`?page=`); every other page, a tab the operator opened the View in
 * among them, owns a hold nobody else can release.
 */
const pageId = new URLSearchParams(location.search).get('page') || crypto.randomUUID()
let revision: number | undefined

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, {
    ...init,
    headers: {
      ...init?.headers,
      'x-astrale-view-host': '1',
      ...(revision === undefined ? {} : { 'x-astrale-view-revision': String(revision) }),
    },
  })
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

function report(state: string, error?: string): void {
  void fetch(`${base}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, error, page: pageId }),
    keepalive: true,
  })
    .then(async (response) => {
      if (!response.ok) return
      const next = (await response.json()) as { revision: number }
      if (revision !== undefined && next.revision !== revision) location.reload()
    })
    .catch(() => {})
}

/**
 * Leaving is explicit: a released session with no page left shuts down instead
 * of waiting out its idle budget. Registered before the first mount, so a page
 * that never came up still hands its hold back.
 *
 * Only a page that is really going: `pagehide` also fires for the back/forward
 * cache, and that page still holds its session - it resumes reporting the
 * moment the reader comes back to it.
 */
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) report('gone')
})

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
  if (cfg.identities?.length) {
    const form = el('identity-form') as HTMLFormElement
    const select = el('identity-select') as HTMLSelectElement
    const button = el('identity-switch') as HTMLButtonElement
    for (const name of cfg.identities)
      select.add(new Option(name, name, false, name === cfg.identity))
    form.hidden = false
    button.disabled = true
    select.onchange = () => {
      button.disabled = select.value === cfg.identity
    }
    form.onsubmit = (event) => {
      event.preventDefault()
      select.disabled = button.disabled = true
      button.textContent = 'Switching…'
      el('frame').inert = true
      void j('/identity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identity: select.value }),
      })
        .then(() => location.reload())
        .catch((error: unknown) => {
          showIntentError(error)
          select.disabled = button.disabled = false
          button.textContent = 'Switch & reload'
          el('frame').inert = false
        })
    }
  }

  report('mounting')
  type ViewToken = { token: string; expiresAt: number }
  const loadToken = async () => {
    const next = await j<ViewToken>('/token', { method: 'POST' })
    return { credential: next.token, expiresAt: next.expiresAt }
  }
  let tokens: ReturnType<typeof createSessionCredentialProvider> | null = null
  if (route.handshake === 'shell') {
    tokens = createSessionCredentialProvider({
      ttlSeconds: cfg.delegationTtlSeconds,
      mint: loadToken,
      initial: await loadToken(),
    })
    // The page outlives many credentials; anticipate rather than pay on the next user action.
    tokens.start()
  }
  const kernelUrl = new URL(cfg.kernelUrl, location.href).href

  const shell = createShell({
    mode: 'standalone',
    session: {
      kernel: cfg.kernelIssuer,
      auth: {
        ttlSeconds: cfg.delegationTtlSeconds,
        resolve: async (invoked, signal) =>
          tokens === null ? {} : tokens.resolve(invoked, signal),
      },
      policy: {
        maximumRouteAgeMs: MAXIMUM_ROUTE_AGE_MS,
        ...(new URL(kernelUrl).protocol === 'http:' ? { allowInsecureHttp: true } : {}),
      },
      envelopeTransport: 'http',
    },
    adapter: accessibleIframeAdapter(createIframeShellAdapter()),
    // No iframe policy: as in the GUI and the Console, a View receives the Shell's shared browser
    // profile, and a requirement beyond it is refused here rather than granted only locally.
    externalOpen: (request) => openExternalBrowserWindow(window, request),
  })
  await shell.init()

  const container = el('frame')
  let mounted: MountedWindow | null = null

  const mount = async (view: ResolvedView): Promise<MountedWindow> => {
    const held = view.route.handshake === 'shell' ? await tokens!.acquire() : undefined
    const credential =
      held === undefined
        ? undefined
        : {
            token: held.credential,
            expiresAt: held.expiresAt,
            refresh: async () => {
              const next = await tokens!.acquire()
              return { token: next.credential, expiresAt: next.expiresAt }
            },
          }
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
