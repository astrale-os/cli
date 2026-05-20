import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Client SPA for astrale-domain views. Built into `../dist-client/`,
 * served by the CF Worker via its `assets:` binding (wrangler.jsonc).
 *
 * `base: '/ui/'` + `outDir: '../dist-client'`: Vite emits asset refs
 * as `/ui/assets/<hash>.js`, wrangler serves files from the directory
 * root (no prefix), so the worker strips `/ui` before delegating.
 * SPA fallback returns `index.html` for unmatched deep paths so
 * TanStack Router handles slug-based routing client-side.
 */
export default defineConfig({
  base: '/ui/',
  plugins: [
    tanstackRouter({
      target: 'react',
      // Auto-split each route into its own chunk — reduces initial bundle.
      autoCodeSplitting: true,
      routesDirectory: 'src/routes',
      generatedRouteTree: 'src/routeTree.gen.ts',
    }),
    viteReact(),
    tailwindcss(),
  ],
  build: {
    outDir: '../dist-client',
    emptyOutDir: true,
    sourcemap: false,
  },
  // `pnpm dev:hmr` — set `VIEW_DEV_URL=http://127.0.0.1:5173` in the
  // worker's `.dev.vars` to proxy `/ui/*` here and get React HMR.
  server: {
    host: '127.0.0.1',
    port: 5173,
    cors: true,
  },
})
