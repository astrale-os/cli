import { createIframeShellAdapter, createShell, type Shell } from '@astrale-os/shell'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '@/lib/api'

const IFRAME_CLASS = 'h-full w-full border-0 bg-white'
const SANDBOX =
  'allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads'

type Phase = 'starting' | 'hosted' | 'standalone'

/**
 * ShellPreview — renders a domain view live, with the studio acting as the AUTHENTICATED
 * shell HOST. It mints a delegation token (server `astrale token`), spins up an
 * `@astrale-os/shell` host, overrides `mintDelegation` to hand the iframe THAT token (so the
 * browser never calls the kernel from localhost), and mounts the view through the shell
 * handshake — so the view receives a real KernelClient instead of timing out. If no token is
 * available (domain not installed / unreachable) or the host mount fails, it falls back to a
 * plain standalone iframe, so there's always something to see.
 */
export function ShellPreview({
  domainId,
  slug,
  url,
}: {
  domainId: string
  slug: string
  url: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>('starting')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let shell: Shell | null = null
    let disposed = false
    setPhase('starting')

    const mountPlain = () => {
      host.replaceChildren()
      const f = document.createElement('iframe')
      f.src = url
      f.title = slug
      f.className = IFRAME_CLASS
      f.referrerPolicy = 'no-referrer'
      f.setAttribute('sandbox', SANDBOX)
      host.appendChild(f)
    }

    void (async () => {
      let pt: Awaited<ReturnType<typeof api.previewToken>> | null = null
      try {
        pt = await api.previewToken(domainId, slug)
      } catch {
        pt = null
      }
      if (disposed) return

      // No host possible (not installed / unreachable / unauthed) → plain standalone iframe.
      if (!pt || pt.status !== 'ok') {
        mountPlain()
        setPhase('standalone')
        return
      }
      const { token, kernelUrl, functionId } = pt

      try {
        shell = createShell({
          mode: 'standalone',
          kernelUrl,
          credential: token,
          adapter: createIframeShellAdapter({ className: IFRAME_CLASS }),
        })
        // Hand the child OUR server-minted token rather than calling the kernel from localhost.
        shell.kernel.mintDelegation = async () => {
          try {
            const fresh = await api.previewToken(domainId, slug)
            if (fresh.status === 'ok') return fresh.token
          } catch {
            /* keep the initial token */
          }
          return token
        }
        await shell.mount({
          host,
          url,
          functionId,
          capabilities: { intents: [] },
          handshake: 'shell',
          delegationTtlSeconds: 1800,
          // No sandbox attribute: the view is the user's own deployed app (trusted) and needs its
          // real origin for the handshake. The default profile drops allow-same-origin → the child
          // gets an opaque "null" origin → ORIGIN_MISMATCH. Cross-origin still isolates it from the studio.
          sandbox: null,
        })
        if (disposed) {
          void shell.dispose()
          return
        }
        setPhase('hosted')
      } catch {
        // host mount failed (handshake refused / view doesn't speak the shell protocol) →
        // fall back to a plain standalone iframe so there's still something to see.
        if (disposed) return
        if (shell) void shell.dispose()
        shell = null
        mountPlain()
        setPhase('standalone')
      }
    })()

    return () => {
      disposed = true
      if (shell) void shell.dispose()
      host.replaceChildren()
    }
  }, [domainId, slug, url])

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {phase === 'starting' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-muted/20 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Starting authenticated preview…
        </div>
      )}
    </div>
  )
}
