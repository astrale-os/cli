/**
 * Development Server
 *
 * Serves worker and iframe bundles locally for hot-reload development.
 */

import type http from 'http'
import { createHostServer } from './server/host-server'
import { createIframeServer } from './server/iframe-server'
import type { DevServer, DevServerConfig } from './server/types'
import { createWorkerServer } from './server/worker-server'

export type { DevServer, DevServerConfig }

const FALLBACK_PORTS = [7018, 7019, 7077, 7123, 7234, 7345, 7456, 7567, 7678, 7789]

function tryListenOnPort(server: http.Server, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false)
      } else {
        throw err
      }
    }
    server.once('error', onError)
    server.listen(port, () => {
      server.off('error', onError)
      resolve(true)
    })
  })
}

async function listenWithFallback(
  server: http.Server,
  preferredPort: number,
  name: string,
): Promise<number> {
  if (await tryListenOnPort(server, preferredPort)) return preferredPort
  for (const port of FALLBACK_PORTS) {
    if (await tryListenOnPort(server, port)) {
      console.log(`  ⚠ Port ${preferredPort} in use, ${name} using ${port} instead`)
      return port
    }
  }
  throw new Error(
    `No available port for ${name}. Tried ${preferredPort} and fallbacks: ${FALLBACK_PORTS.join(', ')}`,
  )
}

export async function createDevServer(config: DevServerConfig): Promise<DevServer> {
  const workerPort = parseInt(new URL(config.workerUrl).port || '80', 10)
  const hostUrl = `http://localhost:${config.hostPort}`
  const workerServer = createWorkerServer(config)
  const hasIframe = !!(config.iframeEntry && config.uiUrl)
  const iframePort = hasIframe ? parseInt(new URL(config.uiUrl!).port || '80', 10) : null
  const iframeState = hasIframe ? await createIframeServer(config) : null

  console.log('\n[sdk-worker] Building host app...')
  const hostState = await createHostServer(config)

  return {
    workerUrl: config.workerUrl,
    iframeUrl: config.uiUrl ?? null,
    hostUrl,

    async start() {
      const actualHostPort = await listenWithFallback(hostState.server, config.hostPort, 'host')
      const actualHostUrl =
        actualHostPort === config.hostPort ? hostUrl : `http://localhost:${actualHostPort}`
      console.log(`  Host:    ${actualHostUrl}`)
      await listenWithFallback(workerServer, workerPort, 'worker')
      console.log(`  Worker:  ${config.workerUrl}`)
      if (iframeState && config.uiUrl && iframePort) {
        await listenWithFallback(iframeState.server, iframePort, 'iframe')
        console.log(`  Iframe:  ${config.uiUrl}`)
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
