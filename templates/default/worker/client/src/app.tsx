import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'

import { ShellProvider } from './providers/shell-provider'
import { routeTree } from './routeTree.gen'

/**
 * Memory history: each view is a sandboxed iframe. The host page URL
 * (`/ui/<slug>`) is decided by the worker — inside the app we only care
 * about the slug at boot and subsequent `setTarget` intents. Memory
 * history avoids fighting the parent's history stack.
 */
function pickInitialPath(): string {
  // Strip `/ui/` — the worker serves every `/ui/<slug>` from the same
  // index.html (SPA fallback). Routes are declared without the `/ui`
  // prefix (see `routes/$slug.tsx`). Must stay in sync with
  // `worker/src/index.ts` which strips the same prefix before ASSETS.
  const raw = typeof location !== 'undefined' ? location.pathname : '/'
  return raw.replace(/^\/ui\/?/, '/')
}

const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: [pickInitialPath()] }),
  defaultPreload: false,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export function App() {
  return (
    <ShellProvider>
      <RouterProvider router={router} />
    </ShellProvider>
  )
}
