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
const configuredVitePort = process.env.STUDIO_VITE_PORT
  ? Number(process.env.STUDIO_VITE_PORT)
  : undefined
const vitePort = configuredVitePort ?? 5173

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
    // bind IPv4 explicitly: Node resolves `localhost` verbatim, so Vite could end up
    // on [::1] only while the studio's dev proxy dials 127.0.0.1 — the page then hangs
    host: '127.0.0.1',
    port: vitePort,
    strictPort: configuredVitePort !== undefined,
    // The page is served by the studio's dev proxy on ANOTHER port and that proxy
    // speaks HTTP only — a socket aimed at the page origin never connects, and the
    // Vite client then reloads the page in a loop. Dial Vite itself.
    ...(configuredVitePort === undefined
      ? {}
      : { hmr: { host: '127.0.0.1', clientPort: configuredVitePort } }),
  },
  // `@astrale-os/shell` resolves to a workspace SOURCE symlink in the monorepo
  // (not the published bundle it was as a standalone package). Pre-bundle it so
  // dev doesn't try to serve its entire shell→kernel source graph as thousands of
  // unbundled on-demand modules (which wedges the browser).
  optimizeDeps: { include: ['@astrale-os/shell'] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // The startup chunk is ~721 kB uncompressed after the Schema UI and its
    // 1.6 MB ELK worker are deferred. Keep a tight budget around that measured
    // baseline so real growth still warns without flagging the intentional app shell.
    chunkSizeWarningLimit: 750,
  },
})
