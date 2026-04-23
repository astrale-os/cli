import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

import { CockpitLayout } from '@/components/cockpit/cockpit-layout'
import { WorkspaceProvider } from '@/providers/workspace'

function PlaygroundPage() {
  const navigate = useNavigate()

  return (
    <WorkspaceProvider>
      <div className="h-full flex flex-col">
        {/* Back bar */}
        <div className="flex items-center gap-3 px-4 py-1.5 border-b bg-muted/30 text-xs">
          <button
            onClick={() => navigate({ to: '/' })}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            All instances
          </button>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">Manager</span>
        </div>
        <div className="flex-1 min-h-0">
          <CockpitLayout />
        </div>
      </div>
    </WorkspaceProvider>
  )
}

export const Route = createFileRoute('/playground')({
  component: PlaygroundPage,
})
