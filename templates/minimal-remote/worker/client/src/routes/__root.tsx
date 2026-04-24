import { createRootRoute, Outlet } from '@tanstack/react-router'

import { useShell } from '../providers/shell-provider'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const { status, error } = useShell()
  return (
    <div className="min-h-screen">
      {status === 'loading' && <Banner tone="neutral">Waiting for parent handshake…</Banner>}
      {status === 'error' && <Banner tone="error">Handshake failed: {error}</Banner>}
      <Outlet />
    </div>
  )
}

function Banner({ tone, children }: { tone: 'neutral' | 'error'; children: React.ReactNode }) {
  const color =
    tone === 'error'
      ? 'bg-red-50 border-red-200 text-red-800'
      : 'bg-amber-50 border-amber-200 text-amber-800'
  return <div className={`border-b px-4 py-2 text-xs ${color}`}>{children}</div>
}
