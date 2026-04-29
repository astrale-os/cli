import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start-plugin'
import viteReact from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const managerPort = process.env.MANAGER_PORT ?? '4400'
const managerTarget = `http://localhost:${managerPort}`

/**
 * TanStack Start dev server on :3200. Serves SSR + hydrated SPA and exposes
 * server functions (e.g. credential signing in src/server/*). Proxies kernel
 * HTTP/WS to the manager so the browser keeps a single origin.
 */
export default defineConfig({
  plugins: [
    tanstackStart({
      customViteReactPlugin: true,
      tsr: {
        srcDirectory: 'src',
        routesDirectory: 'src/routes',
        generatedRouteTree: 'src/routeTree.gen.ts',
      },
    }),
    viteReact(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@domains': fileURLToPath(new URL('../../domains', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3200,
    proxy: {
      '/mngt': { target: managerTarget, ws: true, changeOrigin: false },
      // Instance paths: /:id/ (HTTP) → manager. WS for these is handled by
      // the kernel manager itself — the browser opens ws://localhost:4400/:id/
      // directly using the credential returned by getCredential() server fn.
    },
  },
})
