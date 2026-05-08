import { createFileRoute } from '@tanstack/react-router'

/**
 * Reached when the iframe loads `/ui/` without a slug. Parent normally
 * always mounts a concrete view URL; this route is a fallback and
 * documents the contract.
 */
export const Route = createFileRoute('/')({
  component: () => (
    <div className="p-6">
      <h1 className="text-lg font-semibold">minimal-remote views</h1>
      <p className="text-sm text-muted-foreground mt-1">
        This iframe is a shell-sandboxed app. Load a concrete slug (e.g. `/ui/default`) to render a
        node.
      </p>
    </div>
  ),
})
