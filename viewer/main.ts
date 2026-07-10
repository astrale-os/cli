import { createIframeShellAdapter, createShell } from '@astrale-os/shell'

/**
 * The `astrale view` host page: a thin consumer of the real shell mount
 * machinery. It fetches its config and tokens from the nonce-scoped session
 * server (same origin), mounts the one view, and reports lifecycle states
 * back so the CLI can fail loudly instead of leaving a blank iframe.
 */

type Config = {
  viewUrl: string
  viewPath: string | null
  viewName: string | null
  functionId: string
  handshake: 'shell' | 'none'
  targetNodeId: string | null
  targetPath: string | null
  /** Direct kernel URL (public https) or the nonce-scoped local proxy. */
  kernelUrl: string
  identity: string | null
  instance: string | null
  sessionId: string
}

type Token = { token: string; expiresAt: number; kind: string }

const HEARTBEAT_MS = 5 * 60_000
const HANDSHAKE_TIMEOUT_MS = 10_000
const SHELL_ATTEMPTS = 2

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

async function main(): Promise<void> {
  const cfg = await j<Config>('/config.json')
  el('view-label').textContent = cfg.viewPath ?? cfg.viewUrl
  el('target-label').textContent = cfg.targetPath ?? cfg.targetNodeId ?? ''
  el('identity-label').textContent = [cfg.identity, cfg.instance].filter(Boolean).join(' @ ')
  document.title = `astrale view — ${cfg.viewName ?? cfg.viewPath ?? 'dev'}`

  report('mounting')
  let current = await j<Token>('/token', { method: 'POST' })
  const shell = createShell({
    mode: 'standalone',
    kernelUrl: cfg.kernelUrl,
    getCredential: () => current.token,
    adapter: createIframeShellAdapter(),
  })

  const container = el('frame')
  const mountWith = (handshake: 'shell' | 'none') =>
    shell.mount({
      host: container,
      url: cfg.viewUrl,
      functionId: cfg.functionId,
      targetNodeId: cfg.targetNodeId ?? undefined,
      capabilities: { intents: ['receive', 'closeAck', 'closeRefuse'] },
      sandbox: null,
      handshake,
      handshakeTimeoutMs: HANDSHAKE_TIMEOUT_MS,
      credential: {
        token: current.token,
        expiresAt: current.expiresAt,
        refresh: async () => {
          current = await j<Token>('/token', { method: 'POST' })
          return { token: current.token, expiresAt: current.expiresAt }
        },
      },
    })

  if (cfg.handshake !== 'shell') {
    await mountWith('none')
    setStatus('plain')
    report('plain')
  } else {
    // Cold SPA boots can miss the first handshake window — retry before
    // downgrading to a plain iframe (the GUI host's fallback of last resort).
    let lastError: unknown
    let mounted = false
    for (let attempt = 0; attempt < SHELL_ATTEMPTS && !mounted; attempt++) {
      try {
        await mountWith('shell')
        mounted = true
      } catch (error) {
        lastError = error
        container.replaceChildren()
      }
    }
    if (mounted) {
      setStatus('connected')
      report('connected')
    } else {
      await mountWith('none')
      setStatus('plain')
      report('plain', lastError instanceof Error ? lastError.message : undefined)
    }
  }
  setInterval(() => report('alive'), HEARTBEAT_MS)
}

main().catch(fail)
