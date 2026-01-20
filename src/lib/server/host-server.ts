import type { BuildContext } from 'esbuild'
import esbuild from 'esbuild'
import { readFile, unlink, writeFile } from 'fs/promises'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import { createWorkspaceResolverPlugin } from '../esbuild'
import type { DevServerConfig } from './types'
import { createDedupeReactPlugin, getRepoRoot } from './utils'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface HostServerState {
  server: http.Server
  esbuildCtx: BuildContext | null
  hostBundle: string
  shellBundle: string
  kernelBundle: string
  stylesContent: string
  htmlContent: string
}

export async function createHostServer(config: DevServerConfig): Promise<HostServerState> {
  const state: HostServerState = {
    server: null!,
    esbuildCtx: null,
    hostBundle: '',
    shellBundle: '',
    kernelBundle: '',
    stylesContent: '',
    htmlContent: '',
  }

  const hostDir = path.resolve(__dirname, '../../host')
  const repoRoot = getRepoRoot(__dirname)
  const workspacePlugin = createWorkspaceResolverPlugin()

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
      if (!config.hostConfig.accessToken) {
        console.warn('[host-server] Warning: hostConfig.accessToken is undefined!')
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify(config.hostConfig))
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
