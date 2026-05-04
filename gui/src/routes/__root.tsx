import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useMatches,
} from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'

import appCss from '@/styles.css?url'

const THEME_STORAGE_KEY = 'astrale-theme'
const PHONOGRAPH = 'phonograph'

const themeBootstrapScript = `
(function() {
  try {
    if (localStorage.getItem('${THEME_STORAGE_KEY}') === '${PHONOGRAPH}') {
      document.documentElement.classList.add('${PHONOGRAPH}');
    }
  } catch (_) {}
})();
`

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

function useThemeToggle() {
  const [isPhonograph, setIsPhonograph] = useState(false)

  useEffect(() => {
    setIsPhonograph(document.documentElement.classList.contains(PHONOGRAPH))
  }, [])

  const toggle = () => {
    const next = !document.documentElement.classList.contains(PHONOGRAPH)
    document.documentElement.classList.toggle(PHONOGRAPH, next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? PHONOGRAPH : 'default')
    } catch {}
    setIsPhonograph(next)
  }

  return { isPhonograph, toggle }
}

function RootComponent() {
  const matches = useMatches()
  const instanceMatch = matches.find((m) => 'instanceId' in (m.params as Record<string, unknown>))
  const instanceId = (instanceMatch?.params as { instanceId?: string } | undefined)?.instanceId
  const inIframe = typeof window !== 'undefined' && window.parent !== window
  const { isPhonograph, toggle } = useThemeToggle()

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
          {instanceId ?? 'Shell Demo'}
        </Link>
        <button
          type="button"
          onClick={toggle}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground border border-border px-2 py-1 rounded"
          title="Toggle Phonograph theme"
        >
          theme: {isPhonograph ? 'phonograph' : 'default'}
        </button>
      </header>
      <main
        className={
          instanceId ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 min-h-0 overflow-auto p-6'
        }
      >
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
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <div id="app">{children}</div>
        <Scripts />
      </body>
    </html>
  )
}
