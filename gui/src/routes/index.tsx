import { Link, createFileRoute } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { ShellProvider, useKernel, useShell } from '@/providers/shell'

type KernelInstanceInfo = {
  id: string
  label?: string
  status?: string
}

function managerUrl() {
  if (typeof window === 'undefined') return 'http://localhost:4400/mngt/'
  return `http://${window.location.host}/mngt/`
}

function ManagerPage() {
  const { status, error } = useShell()
  const kernel = useKernel()
  const [instances, setInstances] = useState<KernelInstanceInfo[] | null>(null)
  const [callError, setCallError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const listInstances = useCallback(async () => {
    if (!kernel) return
    setLoading(true)
    setCallError(null)
    try {
      const result = await kernel.call('/manager.astrale.ai/class.KernelInstance/list', {})
      setInstances(result as KernelInstanceInfo[])
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Call failed')
    } finally {
      setLoading(false)
    }
  }, [kernel])

  // Auto-load instances on connect
  useEffect(() => {
    if (status === 'ready') listInstances()
  }, [status, listInstances])

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Connecting to manager...
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="text-destructive">
        <p className="font-medium">Shell init failed</p>
        <p className="text-sm mt-1">{error}</p>
        <p className="text-sm mt-2 text-muted-foreground">
          Make sure the kernel manager is running on port 4400.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">Manager</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Connected to <code className="text-xs bg-muted px-1.5 py-0.5 rounded">/mngt/</code> —
          click an instance to connect to it.
        </p>
      </div>

      <div className="space-y-3">
        <button
          onClick={listInstances}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>

        {callError && (
          <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
            {callError}
          </div>
        )}

        {instances && (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted text-left">
                  <th className="px-4 py-2 font-medium">ID</th>
                  <th className="px-4 py-2 font-medium">Label</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((inst) => (
                  <tr key={inst.id} className="border-t border-border hover:bg-muted/50">
                    <td className="px-4 py-2">
                      <Link
                        to="/kernel/$instanceId"
                        params={{ instanceId: inst.id }}
                        className="font-mono text-xs text-blue-600 hover:underline"
                      >
                        {inst.id}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{inst.label ?? '-'}</td>
                    <td className="px-4 py-2">{inst.status ?? '-'}</td>
                  </tr>
                ))}
                {instances.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-center text-muted-foreground">
                      No kernel instances
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function IndexPage() {
  return (
    <ShellProvider kernelUrl={managerUrl()}>
      <ManagerPage />
    </ShellProvider>
  )
}

export const Route = createFileRoute('/')({
  component: IndexPage,
})
