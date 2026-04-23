import type { IntentMessage } from '@astrale-os/shell'

import { createFileRoute } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { SandboxedShellProvider, useShell } from '@/providers/shell'

type KernelProbe =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; count: number }
  | { status: 'error'; message: string }

function AppContent() {
  const { shell, status, error } = useShell()
  const [probe, setProbe] = useState<KernelProbe>({ status: 'idle' })
  const [refuseClose, setRefuseClose] = useState(false)
  const [lastParentIntent, setLastParentIntent] = useState<string | null>(null)
  const [sendCount, setSendCount] = useState(0)
  const { appId } = Route.useParams()

  // ─── Probe the kernel (proves the delegation token works) ─────────────
  const probeKernel = useCallback(async () => {
    if (!shell) return
    setProbe({ status: 'loading' })
    try {
      const result = await shell.kernel.call('/kernel.astrale.ai/interface.Function/list', {})
      const count = Array.isArray(result) ? result.length : 0
      setProbe({ status: 'ok', count })
    } catch (err) {
      setProbe({ status: 'error', message: err instanceof Error ? err.message : 'Call failed' })
    }
  }, [shell])

  useEffect(() => {
    if (status === 'ready') void probeKernel()
  }, [status, probeKernel])

  // ─── Respond to willClose from the parent ─────────────────────────────
  useEffect(() => {
    if (!shell?.parent) return
    return shell.parent.on('intent', (message: IntentMessage) => {
      setLastParentIntent(String(message.envelope.name))
      if (message.envelope.name !== 'willClose') return
      if (refuseClose) {
        shell.parent!.send({
          type: 'intent',
          version: 1,
          envelope: {
            name: 'closeRefuse',
            payload: { reason: 'Demo: user opted to stay' },
            sender: { windowId: 'self' },
          },
        })
      } else {
        shell.parent!.send({
          type: 'intent',
          version: 1,
          envelope: {
            name: 'closeAck',
            payload: {},
            sender: { windowId: 'self' },
          },
        })
      }
    })
  }, [shell, refuseClose])

  const sendOpen = useCallback(() => {
    if (!shell?.parent) return
    setSendCount((c) => c + 1)
    shell.parent.send({
      type: 'intent',
      version: 1,
      envelope: {
        name: 'open',
        payload: { nodeId: `demo/${appId}/child-${Date.now()}` },
        sender: { windowId: 'self' },
        correlationId: crypto.randomUUID(),
      },
    })
  }, [shell, appId])

  if (status === 'loading') {
    return (
      <div className="w-full h-full flex items-center justify-center p-6 bg-[#fafafa]">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Waiting for parent handshake…
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="w-full h-full flex items-center justify-center p-6 bg-[#fafafa]">
        <div className="text-destructive text-sm">
          <p className="font-medium">Sandbox init failed</p>
          <p className="mt-1">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full bg-gradient-to-br from-sky-50 to-indigo-50 p-6 overflow-auto">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold">Sandboxed app</h1>
            <p className="text-xs text-muted-foreground">
              Running inside a sandboxed iframe — delegated token, isolated kernel client, intents
              routed via the shell.
            </p>
          </div>
          <span className="text-[10px] font-mono bg-sky-100 text-sky-700 px-2 py-0.5 rounded">
            app: {appId}
          </span>
        </div>

        <section className="bg-white/80 backdrop-blur border border-border rounded-lg p-4 space-y-2">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            Kernel probe
          </h2>
          <div className="text-sm">
            {probe.status === 'idle' && <span className="text-muted-foreground">Not run.</span>}
            {probe.status === 'loading' && (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Calling Function/list…
              </span>
            )}
            {probe.status === 'ok' && (
              <span className="text-emerald-700">
                Delegation token works — <strong>{probe.count}</strong> operations returned.
              </span>
            )}
            {probe.status === 'error' && (
              <span className="text-destructive">Call failed: {probe.message}</span>
            )}
          </div>
          <button
            onClick={probeKernel}
            className="text-xs px-2 py-1 bg-muted rounded hover:bg-muted/80"
          >
            Re-run probe
          </button>
        </section>

        <section className="bg-white/80 backdrop-blur border border-border rounded-lg p-4 space-y-3">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
            Intent playground
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={sendOpen}
              className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded hover:opacity-90"
            >
              Send open intent ({sendCount})
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={refuseClose}
              onChange={(e) => setRefuseClose(e.target.checked)}
            />
            Refuse next <code>willClose</code> (demo)
          </label>
          {lastParentIntent && (
            <p className="text-xs text-muted-foreground">
              Last intent from parent:{' '}
              <code className="bg-muted px-1 py-0.5 rounded">{lastParentIntent}</code>
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function AppRoute() {
  return (
    <SandboxedShellProvider>
      <AppContent />
    </SandboxedShellProvider>
  )
}

export const Route = createFileRoute('/app/$appId')({
  component: AppRoute,
})
