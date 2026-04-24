import { createFileRoute } from '@tanstack/react-router'

import { useShell } from '../providers/shell-provider'
import { RENDERERS } from '../renderers'

export const Route = createFileRoute('/$slug')({
  component: SlugRoute,
})

function SlugRoute() {
  const { slug } = Route.useParams()
  const { shell, nodeId } = useShell()
  const Renderer = RENDERERS[slug]
  if (!Renderer) {
    return (
      <div className="p-6">
        <p className="text-red-600">Unknown view: {slug}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Known: {Object.keys(RENDERERS).join(', ')}
        </p>
      </div>
    )
  }
  return <Renderer shell={shell} nodeId={nodeId} />
}
