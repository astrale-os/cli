import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start-plugin'
import viteReact from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const managerPort = process.env.MANAGER_PORT ?? '4400'
const managerTarget = `http://localhost:${managerPort}`

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
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3400,
    proxy: {
      '/mngt': { target: managerTarget, ws: true, changeOrigin: false },
    },
  },
})
