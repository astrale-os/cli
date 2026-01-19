import type { BuildContext, Plugin } from 'esbuild'
import esbuild from 'esbuild'
import { readFile } from 'fs/promises'
import http from 'http'
import path from 'path'
import type { DevServerConfig } from './types'
import { createDedupeReactPlugin, LIVE_RELOAD_SCRIPT } from './utils'

export interface IframeServerState {
  server: http.Server
  esbuildCtx: BuildContext | null
  bundleCode: string
  sseClients: Set<http.ServerResponse>
}

export async function createIframeServer(config: DevServerConfig): Promise<IframeServerState> {
  const state: IframeServerState = {
    server: null!,
    esbuildCtx: null,
    bundleCode: '',
    sseClients: new Set(),
  }

  if (config.iframeEntry) {
    const entryPath = path.resolve(config.projectRoot, config.iframeEntry)

    const liveReloadPlugin: Plugin = {
      name: 'live-reload',
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length === 0 && result.outputFiles?.[0]) {
            state.bundleCode = result.outputFiles[0].text
            console.log(`  ↻ Iframe rebuilt (${(state.bundleCode.length / 1024).toFixed(1)}KB)`)
            for (const client of state.sseClients) client.write('data: reload\n\n')
            config.onIframeChange?.()
          }
        })
      },
    }

    state.esbuildCtx = await esbuild.context({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      write: false,
      jsx: 'automatic',
      jsxImportSource: 'react',
      define: { 'process.env.NODE_ENV': '"development"' },
      plugins: [createDedupeReactPlugin(config.projectRoot), liveReloadPlugin],
    })

    const result = await state.esbuildCtx.rebuild()
    if (result.outputFiles?.[0]) state.bundleCode = result.outputFiles[0].text
  }

  let iframeHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>App</title></head>
<body><div id="root"></div><script type="module" src="/iframe-bundle.js"></script></body>
</html>`

  if (config.iframeHtml) {
    try {
      iframeHtml = await readFile(path.resolve(config.projectRoot, config.iframeHtml), 'utf-8')
    } catch {
      /* Ignore if custom HTML file doesn't exist */
    }
  }
  iframeHtml = iframeHtml.replace('</body>', `${LIVE_RELOAD_SCRIPT}</body>`)

  state.server = http.createServer(async (req, res): Promise<void> => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(200).end()
      return
    }

    const { pathname } = new URL(req.url!, config.uiUrl!)

    if (pathname === '/__dev/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write('data: connected\n\n')
      state.sseClients.add(res)
      req.on('close', () => state.sseClients.delete(res))
      return
    }

    if (pathname === '/' || pathname === '/iframe.html') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' })
      res.end(iframeHtml)
      return
    }

    if (pathname === '/iframe-bundle.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' })
      res.end(state.bundleCode)
      return
    }

    res.writeHead(404).end('Not found')
  })

  return state
}
