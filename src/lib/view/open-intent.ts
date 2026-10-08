import type { IntentMessage, MountedWindow, OpenViewResult, Shell } from '@astrale-os/shell'

import { Path } from '@astrale-os/sdk/graph/path'

/** The Kernel path of a View declaration: `/:<origin>:view.<name>`. */
export type ViewPath = string

export interface ViewOpenHost {
  current(): MountedWindow | null
  setCurrent(window: MountedWindow): void
  /** Resolve and mount one View by its declaration path, on its Domain. */
  open(view: ViewPath): Promise<MountedWindow>
  opened(window: MountedWindow): void
  failed(error: unknown): void
  reply(message: IntentMessage<'view.open'>, result: OpenViewResult): void
  reject(message: IntentMessage<'view.open'>, error: unknown): void
}

/**
 * Register the root host's serialized `view.open` handler. A View asks for another View by its
 * declaration key; the host opens it on its Domain in place of the current mount. Views never
 * open another View for a node: the opened View routes to its node itself.
 */
export function installViewOpenHandler(
  shell: Pick<Shell, 'onIntent'>,
  host: ViewOpenHost,
): () => void {
  let queue = Promise.resolve()
  return shell.onIntent('view.open', (message) => {
    const run = queue.then(() => handleViewOpenIntent(host, message))
    queue = run.catch(() => {})
    return run
  })
}

export async function handleViewOpenIntent(
  host: ViewOpenHost,
  message: IntentMessage<'view.open'>,
): Promise<void> {
  try {
    const path = domainViewPath(message.envelope.payload)
    const previous = host.current()
    const next = await host.open(path)

    host.setCurrent(next)
    host.opened(next)
    // A correlated requester is normally `previous`; answer while its channel
    // still exists, then retire the old mount.
    host.reply(message, { windowId: next.windowId, presentation: next.presentation.kind })

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

/** The declaration path of a requested View; a request for any node but its Domain is refused. */
export function domainViewPath(request: {
  readonly view: string
  readonly target?: string
}): ViewPath {
  const key = String(request.view)
  const separator = key.lastIndexOf(':view.')
  if (separator <= 0) throw new Error(`Invalid View key: ${key}`)
  const origin = key.slice(0, separator)
  if (request.target !== undefined && request.target !== Path.domain(origin).raw) {
    throw new Error(
      `Views open on their Domain only; ${key} cannot open on ${request.target}. Route to the node inside the View.`,
    )
  }
  return `/:${key}`
}
