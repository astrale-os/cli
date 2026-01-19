import { readFile } from 'fs/promises'
import http from 'http'
import type { DevServerConfig } from './types'

export function createWorkerServer(config: DevServerConfig): http.Server {
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
