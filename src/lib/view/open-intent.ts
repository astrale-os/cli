import type { IntentMessage, MountedWindow, ResolvedView, Shell } from '@astrale-os/shell'

export interface OpenIntentHost {
  current(): MountedWindow | null
  setCurrent(window: MountedWindow): void
  mount(view: ResolvedView): Promise<MountedWindow>
  opened(view: ResolvedView): void
  failed(error: unknown): void
  reply(message: IntentMessage<'open'>, windowId: string): void
  reject(message: IntentMessage<'open'>, error: unknown): void
}

/** Register the root host's serialized node-to-View navigation handler. */
export function installOpenIntentHandler(shell: Shell, host: OpenIntentHost): () => void {
  let queue = Promise.resolve()
  return shell.onIntent('open', (message) => {
    const run = queue.then(() => handleOpenIntent(shell, host, message))
    queue = run.catch(() => {})
    return run
  })
}

export async function handleOpenIntent(
  shell: Pick<Shell, 'views'>,
  host: OpenIntentHost,
  message: IntentMessage<'open'>,
): Promise<void> {
  const { nodeId, viewId } = message.envelope.payload
  try {
    const selected = selectResolvedView(await shell.views.resolve(nodeId), viewId)
    const previous = host.current()
    const next = await host.mount(selected)

    host.setCurrent(next)
    host.opened(selected)
    // A correlated requester is normally `previous`; answer while its channel
    // still exists, then retire the old mount.
    host.reply(message, next.windowId)

    if (previous && previous.windowId !== next.windowId) {
      try {
        const closed = await previous.close({ force: true })
        if (closed.kind === 'refused') {
          host.failed(new Error(closed.reason ?? `Window ${previous.windowId} refused to close`))
        }
      } catch (error) {
        host.failed(error)
      }
    }
  } catch (error) {
    host.reject(message, error)
    host.failed(error)
  }
}

export function selectResolvedView(
  views: readonly ResolvedView[],
  viewId: string | undefined,
): ResolvedView {
  const selected = viewId
    ? views.find((view) => view.route.key === viewId || `/:${view.route.key}` === viewId)
    : views[0]
  if (selected) return selected
  throw new Error(
    viewId ? `View ${viewId} does not resolve for this node` : 'No view resolves for this node',
  )
}
