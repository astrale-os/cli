import { createRootRoute, Outlet } from '@tanstack/react-router'

import { ConnectionProvider } from '@/providers/connection'

function RootComponent() {
  return (
    <ConnectionProvider>
      <Outlet />
    </ConnectionProvider>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
})
