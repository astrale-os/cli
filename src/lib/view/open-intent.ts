import type { IntentMessage, MountedWindow, ResolvedView, Shell } from '@astrale-os/shell'

import { rejectIntent, replyToIntent } from '@astrale-os/shell'

export interface OpenIntentHost {
  current(): MountedWindow | null
  setCurrent(window: MountedWindow): void
  mount(view: ResolvedView, nodeId: string): Promise<MountedWindow>
  opened(view: ResolvedView, nodeId: string): void
  failed(error: unknown): void
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
  shell: Pick<Shell, 'children' | 'views'>,
  host: OpenIntentHost,
  message: IntentMessage<'open'>,
): Promise<void> {
  const { nodeId, viewId } = message.envelope.payload
  try {
    const selected = selectResolvedView(await shell.views.resolve(nodeId), viewId)
    const previous = host.current()
    const next = await host.mount(selected, nodeId)

    host.setCurrent(next)
    host.opened(selected, nodeId)
    // A correlated requester is normally `previous`; answer while its channel
    // still exists, then retire the old mount.
    replyToIntent(shell.children, message.envelope.sender.windowId, message, {
      windowId: next.windowId,
    })

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
    rejectIntent(shell.children, message.envelope.sender.windowId, message, error)
    host.failed(error)
  }
}

export function selectResolvedView(
  views: readonly ResolvedView[],
  viewId: string | undefined,
): ResolvedView {
  const selected = viewId ? views.find((view) => view.id === viewId) : views[0]
  if (selected) return selected
  throw new Error(
    viewId ? `View ${viewId} does not resolve for this node` : 'No view resolves for this node',
  )
}

/** Mount a shell view with bounded handshake retries and a plain fallback. */
export async function mountWithHandshakeFallback<T>(opts: {
  handshake: 'shell' | 'none'
  attempts: number
  mount(handshake: 'shell' | 'none'): Promise<T>
  cleanupFailedAttempt(): void
}): Promise<{ mounted: T; handshake: 'shell' | 'none' }> {
  if (opts.handshake === 'none') {
    try {
      return { mounted: await opts.mount('none'), handshake: 'none' }
    } catch (error) {
      opts.cleanupFailedAttempt()
      throw error
    }
  }
  let lastError: unknown
  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    try {
      return { mounted: await opts.mount('shell'), handshake: 'shell' }
    } catch (error) {
      lastError = error
      opts.cleanupFailedAttempt()
    }
  }
  try {
    return { mounted: await opts.mount('none'), handshake: 'none' }
  } catch (error) {
    opts.cleanupFailedAttempt()
    throw error ?? lastError
  }
}
