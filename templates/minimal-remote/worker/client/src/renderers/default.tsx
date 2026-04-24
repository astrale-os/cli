import type { Shell } from '@astrale-os/shell'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@astrale-os/ui-components'

import { classShortName, PROP, readProp, useNode } from '../lib/node'

/**
 * Default renderer — shows the node's class, path, name, and a dump of
 * every stored prop. Duplicate + specialize for domain-specific renderers
 * (e.g. `./user.tsx`, `./task.tsx`) and register them in `./index.ts`.
 */
export function DefaultRenderer({
  shell,
  nodeId,
}: {
  shell: Shell | null
  nodeId: string | undefined
}) {
  const state = useNode(shell, nodeId)

  return (
    <div className="p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            {state.status === 'ok'
              ? (readProp(state.node.props, PROP.named.name) ?? 'Node')
              : 'Node'}
          </CardTitle>
          {state.status === 'ok' && (
            <CardDescription className="font-mono text-xs">
              {classShortName(state.node)} · {state.node.path}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {state.status === 'idle' && (
            <p className="text-muted-foreground text-sm">
              No target node — parent hasn't pushed one yet.
            </p>
          )}
          {state.status === 'loading' && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          )}
          {state.status === 'error' && (
            <p className="text-destructive text-sm">{state.message}</p>
          )}
          {state.status === 'ok' && (
            <section>
              <h2 className="text-sm font-medium text-foreground mb-2">Properties</h2>
              <div className="rounded-lg border bg-card divide-y divide-border">
                {Object.entries(state.node.props).map(([k, v]) => (
                  <div
                    key={k}
                    className="px-3 py-2 text-xs font-mono grid grid-cols-[1fr_1fr] gap-4"
                  >
                    <div className="text-muted-foreground truncate" title={k}>
                      {k}
                    </div>
                    <div className="truncate" title={String(v)}>
                      {String(v)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
