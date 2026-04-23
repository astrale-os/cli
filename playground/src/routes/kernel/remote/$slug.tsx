import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import { useEffect } from 'react'

import { CockpitLayout } from '@/components/cockpit/cockpit-layout'
import { useConnection } from '@/hooks/use-connection'
import { getRemoteKernel } from '@/lib/remote-kernels'
import { ConnectionProvider } from '@/providers/connection'
import { WorkspaceProvider } from '@/providers/workspace'

function RemoteKernelPage() {
  const { slug } = Route.useParams()
  const navigate = useNavigate()
  const remote = getRemoteKernel(slug)

  if (!remote) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground">
        <p className="text-sm mb-4">Remote kernel "{slug}" not found</p>
        <button
          onClick={() => navigate({ to: '/' })}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to instances
        </button>
      </div>
    )
  }

  return (
    <ConnectionProvider skipAutoConnect>
      <WorkspaceProvider>
        <RemoteKernelCockpit wsUrl={remote.url} label={remote.name} />
      </WorkspaceProvider>
    </ConnectionProvider>
  )
}

function RemoteKernelCockpit({ wsUrl, label }: { wsUrl: string; label: string }) {
  const navigate = useNavigate()
  const connection = useConnection()

  useEffect(() => {
    if (connection.authReady && connection.status === 'disconnected') {
      connection.connect(wsUrl)
    }
  }, [wsUrl, connection.authReady]) // eslint-disable-line react-hooks/exhaustive-deps

  if (connection.status === 'error') {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground">
        <AlertCircle className="w-6 h-6 text-red-500 mb-3" />
        <p className="text-sm font-medium text-foreground mb-1">Connection failed</p>
        <p className="text-xs mb-1">{label}</p>
        <p className="text-xs font-mono mb-4">{wsUrl}</p>
        {connection.error && <p className="text-xs text-red-500 mb-4">{connection.error}</p>}
        <div className="flex items-center gap-3">
          <button
            onClick={() => connection.connect(wsUrl)}
            className="px-3 py-1.5 text-sm border rounded-md hover:bg-accent transition-colors"
          >
            Retry
          </button>
          <button
            onClick={() => navigate({ to: '/' })}
            className="flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to instances
          </button>
        </div>
      </div>
    )
  }

  if (connection.status !== 'connected') {
    return (
      <div className="h-full flex items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Connecting to {label}...</span>
      </div>
    )
  }

  return <CockpitLayout label={label} onBack={() => navigate({ to: '/' })} />
}

export const Route = createFileRoute('/kernel/remote/$slug')({
  component: RemoteKernelPage,
})
