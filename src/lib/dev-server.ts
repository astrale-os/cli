/**
 * Development Server
 *
 * Serves worker and iframe bundles locally for hot-reload development.
 */

import type { BuildContext, Plugin } from 'esbuild'
import esbuild from 'esbuild'
import { readFile } from 'fs/promises'
import http from 'http'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DevServerConfig {
  workerUrl: string
  uiUrl?: string
  hostPort: number
  workerOutFile: string
  iframeEntry?: string
  iframeHtml?: string
  projectRoot: string
  configPath: string
  onWorkerChange?: () => void
  onIframeChange?: () => void
}

export interface DevServer {
  workerUrl: string
  iframeUrl: string
  hostUrl: string
  start(): Promise<void>
  stop(): Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Plugins
// ─────────────────────────────────────────────────────────────────────────────

const LIVE_RELOAD_SCRIPT = `<script>
(function() {
  const es = new EventSource('/__dev/events');
  es.onmessage = e => e.data === 'reload' && location.reload();
})();
</script>`

/** Dedupe React to a single copy resolved from projectRoot (handles pnpm hoisting) */
function createDedupeReactPlugin(projectRoot: string): Plugin {
  const projectRequire = createRequire(path.join(projectRoot, 'package.json'))

  const resolve = (pkg: string): string => {
    try {
      return projectRequire.resolve(pkg)
    } catch {
      return ''
    }
  }

  return {
    name: 'dedupe-react',
    setup(build) {
      const packages = [
        'react',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom',
        'react-dom/client',
      ]
      for (const pkg of packages) {
        const filter = new RegExp(`^${pkg.replace('/', '\\/')}$`)
        build.onResolve({ filter }, () => {
          const resolved = resolve(pkg)
          return resolved ? { path: resolved } : null
        })
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Server
// ─────────────────────────────────────────────────────────────────────────────

function createWorkerServer(config: DevServerConfig): http.Server {
  const origin = new URL(config.workerUrl).origin

  return http.createServer(async (req, res): Promise<void> => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(200).end()
      return
    }

    const { pathname } = new URL(req.url!, origin)

    if (pathname === '/' || pathname === '/worker.js') {
      try {
        const code = await readFile(config.workerOutFile, 'utf-8')
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-cache',
        })
        res.end(code)
      } catch {
        res.writeHead(404).end(`Worker not found: ${config.workerOutFile}`)
      }
      return
    }

    if (pathname === '/worker.js.map') {
      try {
        const map = await readFile(`${config.workerOutFile}.map`, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
        res.end(map)
      } catch {
        res.writeHead(404).end('Source map not found')
      }
      return
    }

    res.writeHead(404).end('Not found')
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Iframe Server
// ─────────────────────────────────────────────────────────────────────────────

interface IframeServerState {
  server: http.Server
  esbuildCtx: BuildContext | null
  bundleCode: string
  sseClients: Set<http.ServerResponse>
}

async function createIframeServer(config: DevServerConfig): Promise<IframeServerState> {
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

// ─────────────────────────────────────────────────────────────────────────────
// Host Server
// ─────────────────────────────────────────────────────────────────────────────

interface HostServerState {
  server: http.Server
  esbuildCtx: BuildContext | null
  hostBundle: string
  shellBundle: string
  kernelBundle: string
  stylesContent: string
  htmlContent: string
}

async function createHostServer(config: DevServerConfig): Promise<HostServerState> {
  const state: HostServerState = {
    server: null!,
    esbuildCtx: null,
    hostBundle: '',
    shellBundle: '',
    kernelBundle: '',
    stylesContent: '',
    htmlContent: '',
  }

  const hostDir = path.resolve(__dirname, '../host')
  const repoRoot = path.resolve(__dirname, '../../../..')
  const { writeFile, unlink } = await import('fs/promises')

  const workspacePlugin: Plugin = {
    name: 'workspace-resolver',
    setup(build) {
      const packageMap: Record<string, string> = {
        '@astrale-os/shell-runtime': path.join(repoRoot, 'shell/runtime/index.ts'),
        '@astrale-os/shell-core': path.join(repoRoot, 'shell/core/src/index.ts'),
        '@astrale-os/kernel-client-ws': path.join(repoRoot, 'clients/kernel-ws-ts/src/index.ts'),
        '@astrale-os/kernel-core': path.join(repoRoot, 'kernel/core/index.ts'),
        '@astrale-os/datastore-client': path.join(repoRoot, 'clients/datastore-ts/src/index.ts'),
      }
      build.onResolve({ filter: /^@astrale\// }, (args) => {
        const resolved = packageMap[args.path]
        return resolved ? { path: resolved } : null
      })
    },
  }

  const buildIIFE = async (entryCode: string, globalName: string) => {
    const entryFile = path.join(hostDir, `_${globalName}-entry.ts`)
    await writeFile(entryFile, entryCode)
    try {
      const result = await esbuild.build({
        entryPoints: [entryFile],
        bundle: true,
        format: 'iife',
        globalName,
        platform: 'browser',
        target: 'es2020',
        write: false,
        define: { 'process.env.NODE_ENV': '"development"' },
        plugins: [workspacePlugin],
        nodePaths: [path.join(repoRoot, 'node_modules')],
      })
      return result.outputFiles?.[0]?.text ?? ''
    } finally {
      await unlink(entryFile).catch(() => {})
    }
  }

  console.log('  Building shell bundle...')
  state.shellBundle = await buildIIFE(
    `export { Shell } from "@astrale-os/shell-runtime";\nexport { wrapControl, unwrap, MSG } from "@astrale-os/shell-core";`,
    'ShellBundle',
  )
  console.log(`    Shell: ${(state.shellBundle.length / 1024).toFixed(1)}KB`)

  console.log('  Building kernel client bundle...')
  try {
    state.kernelBundle = await buildIIFE(
      `export { KernelWSClient } from "@astrale-os/kernel-client-ws";`,
      'KernelWSClientBundle',
    )
    console.log(`    Kernel: ${(state.kernelBundle.length / 1024).toFixed(1)}KB`)
  } catch {
    console.warn('    Kernel bundle failed, will use inline')
  }

  console.log('  Building host app bundle...')
  state.esbuildCtx = await esbuild.context({
    entryPoints: [path.join(hostDir, 'main.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    write: false,
    jsx: 'automatic',
    jsxImportSource: 'react',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [createDedupeReactPlugin(config.projectRoot)],
  })

  const hostResult = await state.esbuildCtx.rebuild()
  state.hostBundle = hostResult.outputFiles?.[0]?.text ?? ''
  console.log(`    Host: ${(state.hostBundle.length / 1024).toFixed(1)}KB`)

  try {
    state.stylesContent = await readFile(path.join(hostDir, 'styles.css'), 'utf-8')
  } catch {
    state.stylesContent = ''
  }

  try {
    state.htmlContent = await readFile(path.join(hostDir, 'index.html'), 'utf-8')
  } catch {
    state.htmlContent = `<!DOCTYPE html><html><head><title>Dev Host</title></head><body><div id="root"></div><script type="module" src="/host/bundle.js"></script></body></html>`
  }

  let configJson = '{}'
  try {
    configJson = await readFile(config.configPath, 'utf-8')
  } catch {
    console.warn('  Warning: Could not load config.json')
  }

  state.server = http.createServer(async (req, res): Promise<void> => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(200).end()
      return
    }

    const { pathname } = new URL(req.url!, `http://localhost:${config.hostPort}`)

    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' })
      res.end(state.htmlContent)
      return
    }

    if (pathname === '/config.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
      res.end(configJson)
      return
    }

    if (pathname === '/host/bundle.js') {
      const fullBundle = `// Shell\n${state.shellBundle}\n// Kernel\n${state.kernelBundle}\n// Host\n${state.hostBundle}`
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' })
      res.end(fullBundle)
      return
    }

    if (pathname === '/host/styles.css') {
      res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-cache' })
      res.end(state.stylesContent)
      return
    }

    res.writeHead(404).end('Not found')
  })

  return state
}

// ─────────────────────────────────────────────────────────────────────────────
// Dev Server Factory
// ─────────────────────────────────────────────────────────────────────────────

export async function createDevServer(config: DevServerConfig): Promise<DevServer> {
  const workerPort = parseInt(new URL(config.workerUrl).port || '80', 10)
  const iframePort = config.uiUrl ? parseInt(new URL(config.uiUrl).port || '80', 10) : 3101
  const hostUrl = `http://localhost:${config.hostPort}`

  const workerServer = createWorkerServer(config)
  const iframeState = config.iframeEntry && config.uiUrl ? await createIframeServer(config) : null

  console.log('\n[sdk-worker] Building host app...')
  const hostState = await createHostServer(config)

  return {
    workerUrl: config.workerUrl,
    iframeUrl: config.uiUrl ?? `http://localhost:${iframePort}`,
    hostUrl,

    async start() {
      await new Promise<void>((r) =>
        hostState.server.listen(config.hostPort, () => (console.log(`  Host:    ${hostUrl}`), r())),
      )
      await new Promise<void>((r) =>
        workerServer.listen(workerPort, () => (console.log(`  Worker:  ${config.workerUrl}`), r())),
      )

      if (iframeState && config.uiUrl) {
        await new Promise<void>((r) =>
          iframeState.server.listen(
            iframePort,
            () => (console.log(`  Iframe:  ${config.uiUrl}`), r()),
          ),
        )
        await iframeState.esbuildCtx?.watch()
      }
    },

    async stop() {
      hostState.server.close()
      await hostState.esbuildCtx?.dispose()
      workerServer.close()
      if (iframeState) {
        iframeState.server.close()
        await iframeState.esbuildCtx?.dispose()
        for (const client of iframeState.sseClients) client.end()
      }
    },
  }
}
