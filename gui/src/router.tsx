import { createRouter as createTanStackRouter, Navigate } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

export function createRouter() {
  return createTanStackRouter({
    routeTree,
    defaultNotFoundComponent: () => <Navigate to="/" />,
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultStructuralSharing: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
