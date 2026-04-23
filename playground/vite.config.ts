import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { createConnection } from 'node:net'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const managerPort = process.env.MANAGER_PORT ?? '4400'
const managerTarget = `http://localhost:${managerPort}`

/** Matches kernel instance paths: /{id}/ */
const instancePattern = /^\/[a-z0-9][a-z0-9_-]*\//

/**
 * Vite plugin to proxy WebSocket upgrades for kernel instance paths.
 *
 * Vite's built-in proxy only handles WS upgrades for string-prefix rules,
 * not regex rules. This plugin intercepts upgrade requests matching the
 * instance path pattern and tunnels them to the kernel manager.
 */
function kernelWsProxy(): Plugin {
  return {
    name: 'kernel-instance-ws-proxy',
    configureServer(server) {
      server.httpServer!.on('upgrade', (req, socket, head) => {
        const url = req.url ?? ''
        // Skip paths already handled by Vite's string proxy rules
        if (url.startsWith('/mngt')) return
        if (!instancePattern.test(url)) return

        // Tunnel the WS upgrade to the kernel manager via raw TCP
        const upstream = createConnection({ host: 'localhost', port: Number(managerPort) }, () => {
          // Reconstruct the HTTP upgrade request
          const headers = Object.entries(req.headers)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
            .join('\r\n')

          upstream.write(`${req.method} ${url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`)

          if (head.length > 0) upstream.write(head)

          // Bidirectional pipe
          upstream.pipe(socket)
          socket.pipe(upstream)
        })

        upstream.on('error', () => socket.destroy())
        socket.on('error', () => upstream.destroy())
      })
    },
  }
}

export default defineConfig({
  base: '/playground/',
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    viteReact(),
    tailwindcss(),
    kernelWsProxy(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@kernel-domains': fileURLToPath(new URL('../../kernel/domains', import.meta.url)),
    },
  },
  build: {
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': managerTarget,
      '/mngt': {
        target: managerTarget,
        ws: true,
      },
      // HTTP-only proxy for instance paths (WS handled by kernelWsProxy plugin)
      '^/[a-z0-9][a-z0-9_-]*/$': {
        target: managerTarget,
      },
    },
  },
})
