import {
  createShell,
  createIframeShellAdapter,
  requestIntent,
  NO_HOST_CAPABILITIES,
  type ResolvedView,
} from '@astrale-os/shell'

const shell = createShell({ mode: 'sandboxed', adapter: createIframeShellAdapter() })
await shell.init()
const provider = new URL(location.href).searchParams.get('provider')!
const other = provider.includes('provider-a')
  ? 'https://provider-b.example'
  : 'https://provider-a.example'
document.body.innerHTML = `<button id="open">Open provider</button><button id="other">Open other</button><button id="slow">Slow open</button><button id="nested">Mount nested</button><button id="escalate">Escalate nested</button><output id="status">ready</output><div id="nested-host"></div>`
const status = document.querySelector('output')!
async function open(url: string) {
  const result = await requestIntent(shell.parent!, 'browser.openExternal', {
    url: `${url}/session`,
    mode: 'popup',
  })
  status.textContent = result.outcome
}
document.querySelector('#open')!.addEventListener('click', () => void open(provider))
document.querySelector('#other')!.addEventListener('click', () => void open(other))
document.querySelector('#slow')!.addEventListener('click', () => {
  status.textContent = 'preparing'
  setTimeout(() => void open(provider), 6_000)
})
async function nested(origin: string) {
  try {
    await shell.openView({
      host: document.querySelector('#nested-host') as HTMLElement,
      view: {
        target: '/:browser-fixture.example' as ResolvedView['target'],
        route: {
          key: 'browser-fixture.example:view.nested',
          declaration: { target: { kind: 'domain' } },
          href: `https://nested.view.example/?provider=${encodeURIComponent(origin)}`,
          handshake: 'shell',
          issuer: 'https://browser-fixture.example' as ResolvedView['route']['issuer'],
          etag: `sha256:${'c'.repeat(64)}`,
          revision: `sha256:${'d'.repeat(64)}` as ResolvedView['route']['revision'],
          host: { navigation: { external: { origins: [origin] } } },
        },
      },
      capabilities: NO_HOST_CAPABILITIES,
      credential: { token: 'browser-fixture', expiresAt: Date.now() + 60_000 },
    })
    status.textContent = 'nested-ready'
  } catch {
    status.textContent = 'nested-denied'
  }
}
document.querySelector('#nested')!.addEventListener('click', () => void nested(provider))
document.querySelector('#escalate')!.addEventListener('click', () => void nested(other))
