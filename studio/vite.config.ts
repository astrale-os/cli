import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The Domain Studio SPA. Built into client/dist and served by the Bun server.
// In dev, `vite` runs HMR and the Bun server proxies non-/api requests to it
// (see DOMAIN_STUDIO_DEV in server/index.ts).
//
// When the studio server fronts Vite on a DIFFERENT port (the `astrale studio
// --dev` proxy), the page origin is the studio port but Vite listens on its own
// port — so the HMR WebSocket must target Vite directly. `astrale studio` passes
// Vite's port as STUDIO_VITE_PORT for exactly that.
const hmrPort = process.env.STUDIO_VITE_PORT ? Number(process.env.STUDIO_VITE_PORT) : undefined

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./client/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    ...(hmrPort ? { hmr: { clientPort: hmrPort, host: '127.0.0.1' } } : {}),
  },
  // `@astrale-os/shell` resolves to a workspace SOURCE symlink in the monorepo
  // (not the published bundle it was as a standalone package). Pre-bundle it so
  // dev doesn't try to serve its entire shell→kernel source graph as thousands of
  // unbundled on-demand modules (which wedges the browser).
  optimizeDeps: { include: ['@astrale-os/shell'] },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
})
