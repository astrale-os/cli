import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { CockpitLayout } from '@/components/cockpit/cockpit-layout'
import { useConnection } from '@/hooks/use-connection'
import { ConnectionProvider } from '@/providers/connection'
import { WorkspaceProvider } from '@/providers/workspace'

function KernelPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const managerConnection = useConnection() // from root ConnectionProvider
  const [ready, setReady] = useState(false)
  const [label, setLabel] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (managerConnection.status !== 'connected' || !managerConnection.manager) return

    managerConnection.manager
      .static('KernelInstance')
      .info({ id })
      .then((info) => {
        if (info.status !== 'ready') {
          setError(`Kernel "${id}" is not running (status: ${info.status})`)
          return
        }
        setLabel(info.label || info.id)
        setReady(true)
      })
      .catch((e) => setError(e.message))
  }, [id, managerConnection.status, managerConnection.manager]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground">
        <p className="text-sm mb-4">{error}</p>
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

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Connecting to {id}...
      </div>
    )
  }

  const wsUrl = `http://${window.location.host}/${id}/`

  return (
    <ConnectionProvider skipAutoConnect>
      <WorkspaceProvider>
        <KernelCockpit wsUrl={wsUrl} label={label} />
      </WorkspaceProvider>
    </ConnectionProvider>
  )
}

function KernelCockpit({ wsUrl, label }: { wsUrl: string; label: string }) {
  const navigate = useNavigate()
  const connection = useConnection()

  useEffect(() => {
    if (connection.authReady && connection.status === 'disconnected') {
      connection.connect(wsUrl)
    }
  }, [wsUrl, connection.authReady]) // eslint-disable-line react-hooks/exhaustive-deps

  return <CockpitLayout label={label} onBack={() => navigate({ to: '/' })} />
}

export const Route = createFileRoute('/kernel/$id')({
  component: KernelPage,
})
