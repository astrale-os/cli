import { capabilitiesMiddleware, loggingMiddleware, type IntentMessage } from '@astrale-os/shell'
import { createFileRoute } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { MessageLog } from '@/components/message-log'
import { WindowsPanel } from '@/components/windows-panel'
import { StandaloneShellProvider, useKernel, useShell } from '@/providers/shell'

function instanceUrl(instanceId: string) {
  if (typeof window === 'undefined') return `http://localhost:4400/${instanceId}/`
  return `http://${window.location.host}/${instanceId}/`
}

function appUrl(appId: string) {
  // Build an absolute URL so the iframe and the expected origin check match.
  // Gui is served by its own TanStack Start server at :3400, at root path.
  if (typeof window === 'undefined') return `http://localhost:3400/app/${appId}`
  return `${window.location.origin}/app/${appId}`
}

type OperationEntry = {
  path: string
  name?: string
  class?: string
}

function InstancePage() {
  const { instanceId } = Route.useParams()
  const { shell, status, error, kernelUrl } = useShell()
  const kernel = useKernel()
  const [operations, setOperations] = useState<OperationEntry[] | null>(null)
  const [callError, setCallError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [capabilityViolations, setCapabilityViolations] = useState<number>(0)

  const listOperations = useCallback(async () => {
    if (!kernel) return
    setLoading(true)
    setCallError(null)
    try {
      const result = await kernel.call('/kernel.astrale.ai/interface.Function/list', {})
      setOperations(result as OperationEntry[])
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Call failed')
    } finally {
      setLoading(false)
    }
  }, [kernel])

  useEffect(() => {
    if (status === 'ready') void listOperations()
  }, [status, listOperations])

  // Wire middleware (logging + capabilities) once when the shell is ready.
  const middlewareWired = useMemo(() => new WeakSet<object>(), [])
  useEffect(() => {
    if (!shell || middlewareWired.has(shell)) return
    middlewareWired.add(shell)

    shell.use(loggingMiddleware())
    shell.use(
      capabilitiesMiddleware({
        selfWindowId: 'root',
        allowSelf: true,
        lookup: (sender) => {
          const win = shell.windows.get(sender)
          return win?.capabilities
        },
        onViolation: () => setCapabilityViolations((v) => v + 1),
      }),
    )
  }, [shell, middlewareWired])

  // React to "open" intents coming from children — dispatch to its parent sink
  // or handle locally. For the demo we just acknowledge with a receive back.
  useEffect(() => {
    if (!shell) return
    return shell.children.on('intent', (fromWindowId, message: IntentMessage) => {
      if (message.envelope.name !== 'open') return
      const corr = message.envelope.correlationId
      shell.children.send(fromWindowId, {
        type: 'intent',
        version: 1,
        envelope: {
          name: 'receive',
          payload: {
            data: {
              handled: true,
              nodeId: (message.envelope.payload as { nodeId?: string }).nodeId,
            },
            sourceIntent: 'open',
          },
          sender: { windowId: 'root' },
          ...(corr ? { correlationId: corr } : {}),
        },
      })
    })
  }, [shell])

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Connecting to <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{instanceId}</code>…
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="text-destructive">
        <p className="font-medium">Connection failed</p>
        <p className="text-sm mt-1">{error}</p>
        <p className="text-sm mt-2 text-muted-foreground">
          Kernel URL: <code>{kernelUrl}</code>
        </p>
      </div>
    )
  }

  const iframeUrl = appUrl(`demo-${instanceId}`)

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold">Instance: {instanceId}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Connected to <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{kernelUrl}</code>
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Operations</h3>
          <button
            onClick={listOperations}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {callError && (
          <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
            {callError}
          </div>
        )}

        {operations && (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-2 bg-muted text-xs font-medium text-muted-foreground">
              {operations.length} operations (Function/list)
            </div>
            <div className="max-h-[30vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium">Path</th>
                    <th className="px-4 py-2 font-medium">Class</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((op) => (
                    <tr key={op.path} className="border-t border-border">
                      <td className="px-4 py-1.5 font-mono text-xs">{op.path}</td>
                      <td className="px-4 py-1.5 text-xs text-muted-foreground">
                        {op.class ?? '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <WindowsPanel iframeUrl={iframeUrl} functionId={`demo-app:${instanceId}`} />
          {capabilityViolations > 0 && (
            <div className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded border border-amber-200">
              Blocked intents: {capabilityViolations}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Traffic</h3>
          <MessageLog />
        </section>
      </div>
    </div>
  )
}

function InstanceRoute() {
  const { instanceId } = Route.useParams()
  return (
    <StandaloneShellProvider kernelUrl={instanceUrl(instanceId)}>
      <InstancePage />
    </StandaloneShellProvider>
  )
}

export const Route = createFileRoute('/kernel/$instanceId')({
  component: InstanceRoute,
})
