import type { ReactNode } from 'react'

import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useMatches,
} from '@tanstack/react-router'

import appCss from '@/styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
      { title: 'Shell Demo' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
})

function RootComponent() {
  const matches = useMatches()
  const instanceMatch = matches.find((m) => 'instanceId' in (m.params as Record<string, unknown>))
  const instanceId = (instanceMatch?.params as { instanceId?: string } | undefined)?.instanceId
  const inIframe = typeof window !== 'undefined' && window.parent !== window

  if (inIframe) {
    return (
      <div className="h-full w-full">
        <Outlet />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-6 py-3 border-b border-border">
        <Link to="/" className="font-bold text-base hover:opacity-70">
          Shell Demo
        </Link>
        {instanceId && (
          <span className="text-sm text-muted-foreground">
            / instance: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{instanceId}</code>
          </span>
        )}
      </header>
      <main className="flex-1 min-h-0 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div id="app">{children}</div>
        <Scripts />
      </body>
    </html>
  )
}
