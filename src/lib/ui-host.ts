import { guiDistDir } from '@astrale-os/astrale-gui/dist-path'
import { playgroundDistDir } from '@astrale-os/astrale-playground/dist-path'
import {
  node,
  type NodeDriverConfig,
  type TransportDriver,
  type TransportPorts,
} from '@astrale-os/kernel-toolkit'
import { serveStatic } from '@hono/node-server/serve-static'

import { API_TOKEN_HEADER, API_TOKEN_PARAM, tokensMatch } from './api-token'

export interface UiHostOptions {
  /**
   * Credential returned by `GET /api/auth` so the browser can authenticate
   * kernel calls. Typically the manager's own credential from `resolveAuth`.
   */
  readonly credential: string
  /**
   * API token that `/api/auth` requires callers to present (header or query
   * param). Regenerated on every `astrale start`; surfaced to the user as a
   * `?token=...` in the launch URL. If omitted, `/api/auth` is open — kept
   * as an escape hatch for tests and backwards compatibility only.
   */
  readonly apiToken?: string
}

const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Astrale</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 640px; margin: 6rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  p { color: #666; margin-top: 0; }
  ul { list-style: none; padding: 0; margin-top: 2rem; }
  li { margin: 0.75rem 0; }
  a { display: inline-block; padding: 0.75rem 1rem; border: 1px solid #ddd; border-radius: 6px; text-decoration: none; color: inherit; }
  a:hover { background: rgba(0,0,0,0.04); }
  code { font-family: ui-monospace, monospace; font-size: 0.85em; background: rgba(0,0,0,0.06); padding: 0.1em 0.35em; border-radius: 3px; }
</style>
</head>
<body>
<h1>Astrale</h1>
<p>Manager running. Pick a UI:</p>
<ul>
  <li><a href="/playground/">Playground <span style="color:#888">— graph cockpit, kernel exploration</span></a></li>
  <li><a href="/gui/">GUI <span style="color:#888">— shell demo (windows, intents, delegation)</span></a></li>
</ul>
</body>
</html>
`

/**
 * Transport driver that wraps `node()` and additionally serves the Astrale
 * UIs (playground under /playground/, gui under /gui/) + `/api/auth` on the
 * same HTTP server as the kernel.
 *
 * UI routes are attached right before `listen()`, i.e. after the kernel has
 * mounted its own routes on the registrar — so `/mngt`, `/:id/`, and
 * `/.well-known/*` keep priority over the SPA fallback.
 */
export function nodeWithUi(opts: UiHostOptions, nodeConfig?: NodeDriverConfig): TransportDriver {
  const inner = node(nodeConfig)
  return {
    ...inner,
    kind: 'transport/node-with-ui',
    async init(ctx) {
      const ports: TransportPorts = await inner.init(ctx)
      const innerListen = ports.listen.bind(ports)
      return {
        ...ports,
        async listen(listenOpts) {
          const hono = ports.hono
          if (hono) {
            hono.get('/api/auth', (c) => {
              if (opts.apiToken) {
                const provided =
                  c.req.header(API_TOKEN_HEADER) ??
                  new URL(c.req.url).searchParams.get(API_TOKEN_PARAM) ??
                  ''
                if (!tokensMatch(opts.apiToken, provided)) {
                  return c.json({ error: 'unauthorized' }, 401)
                }
              }
              return c.json({ credential: opts.credential })
            })
            hono.use('/playground/assets/*', serveStatic({ root: playgroundDistDir }))
            hono.get('/playground/*', serveStatic({ root: playgroundDistDir, path: 'index.html' }))
            hono.use('/gui/assets/*', serveStatic({ root: guiDistDir }))
            hono.get('/gui/*', serveStatic({ root: guiDistDir, path: 'index.html' }))
            hono.get('/', (c) => c.html(LANDING_HTML))
          }
          return innerListen(listenOpts)
        },
      }
    },
  }
}
