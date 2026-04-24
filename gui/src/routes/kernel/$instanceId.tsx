import { createFileRoute } from '@tanstack/react-router'
import { Loader2, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { NodeTree, type KernelNode } from '@/components/node-tree'
import { StandaloneShellProvider, useKernel, useShell } from '@/providers/shell'

type ResolvedView = {
  id: string
  path: string
  url: string
  name?: string
  origin: 'self' | 'instance' | 'class'
}

type StagedView = {
  node: KernelNode
  view: ResolvedView
}

function instanceUrl(instanceId: string) {
  return `http://localhost:4400/${instanceId}/`
}

// Propagate the kernel node id into the view URL as `?node=<id>` so static
// views (no shell handshake) can self-identify their subject.
function appendTargetNode(url: string, nodeId: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set('node', nodeId)
    return u.toString()
  } catch {
    return url + (url.includes('?') ? '&' : '?') + `node=${encodeURIComponent(nodeId)}`
  }
}

const RESOLVER_METHOD = '/dist-v2.localhost/class.View/resolve'

function InstancePage() {
  const { instanceId } = Route.useParams()
  const { status, error } = useShell()
  const kernel = useKernel()
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [staged, setStaged] = useState<StagedView | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ node: KernelNode; views: ResolvedView[] } | null>(null)
  const [resolving, setResolving] = useState(false)

  const openView = useCallback((node: KernelNode, view: ResolvedView) => {
    if (!stageRef.current) return
    setStatusMsg(null)
    const iframe = document.createElement('iframe')
    iframe.src = view.origin === 'self' ? view.url : appendTargetNode(view.url, node.id)
    iframe.style.width = '100%'
    iframe.style.height = '100%'
    iframe.style.border = '0'
    iframe.sandbox.value = 'allow-scripts allow-same-origin'
    stageRef.current.replaceChildren(iframe)
    setStaged({ node, view })
  }, [])

  const onOpen = useCallback(
    async (node: KernelNode) => {
      if (!kernel) return
      setPicker(null)
      setStatusMsg(null)
      setResolving(true)
      try {
        const views = (await kernel.call(RESOLVER_METHOD, { node: node.path })) as ResolvedView[]
        if (views.length === 0) {
          setStatusMsg(`No view available for ${node.path}`)
          return
        }
        if (views.length === 1) {
          openView(node, views[0]!)
          return
        }
        setPicker({ node, views })
      } catch (err) {
        setStatusMsg(err instanceof Error ? err.message : 'View.resolve failed')
      } finally {
        setResolving(false)
      }
    },
    [kernel, openView],
  )

  const closeStaged = useCallback(() => {
    stageRef.current?.replaceChildren()
    setStaged(null)
  }, [])

  if (status === 'loading') {
    return (
      <div className="h-full w-full flex items-center gap-2 text-muted-foreground p-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        Connecting to <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{instanceId}</code>…
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="p-4 text-destructive">
        <p className="font-medium">Connection failed</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden">
      <aside className="w-72 shrink-0 border-r border-border flex flex-col">
        <div className="px-3 py-2 border-b border-border text-xs font-semibold flex items-center justify-between">
          <span>Graph</span>
          <code className="text-[10px] font-mono text-muted-foreground">{instanceId}</code>
        </div>
        <div className="flex-1 overflow-auto">
          {kernel && <NodeTree kernel={kernel} onOpen={onOpen} />}
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative">
        <div className="px-3 py-2 border-b border-border text-xs flex items-center gap-3">
          {staged ? (
            <>
              <span className="font-semibold truncate">{staged.view.name ?? staged.view.path}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                origin: {staged.view.origin}
              </span>
              <span className="text-muted-foreground truncate">for {staged.node.path}</span>
              <button
                onClick={closeStaged}
                className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-destructive"
              >
                <X className="w-3 h-3" />
                Close
              </button>
            </>
          ) : (
            <span className="text-muted-foreground">
              {resolving ? 'Resolving…' : 'Double-click a node in the tree to open it.'}
            </span>
          )}
        </div>

        {statusMsg && (
          <div className="px-3 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-200">
            {statusMsg}
          </div>
        )}

        <div className="flex-1 bg-background relative overflow-hidden">
          <div ref={stageRef} className="absolute inset-0" />
          {!staged && !statusMsg && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground pointer-events-none">
              No view mounted.
            </div>
          )}
        </div>
      </main>

      {picker && (
        <Picker
          node={picker.node}
          views={picker.views}
          onPick={(v) => {
            setPicker(null)
            void openView(picker.node, v)
          }}
          onCancel={() => setPicker(null)}
        />
      )}
    </div>
  )
}

function Picker({
  node,
  views,
  onPick,
  onCancel,
}: {
  node: KernelNode
  views: ResolvedView[]
  onPick(v: ResolvedView): void
  onCancel(): void
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
      <div className="bg-background border border-border rounded-lg shadow-xl w-[420px] p-4">
        <div className="text-sm font-semibold">Choose a view</div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate">{node.path}</div>
        <div className="mt-3 space-y-1">
          {views.map((v) => (
            <button
              key={v.id}
              onClick={() => onPick(v)}
              className="w-full text-left px-3 py-2 rounded border border-border hover:bg-muted"
            >
              <div className="text-sm font-medium">{v.name ?? v.path}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                origin: {v.origin}
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">{v.url}</div>
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded hover:bg-muted">
            Cancel
          </button>
        </div>
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
