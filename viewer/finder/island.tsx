import type { KernelClient, NodeSelectorRequests, PendingSelectNodes } from '@astrale-os/shell'
import type { FinderChoice, FinderSource } from '@astrale-os/ui/finder'

import { createGraphFinderSource } from '@astrale-os/shell'
import {
  Component,
  type ReactNode,
  StrictMode,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import { createRoot } from 'react-dom/client'

import {
  type PlaceStorage,
  refusalMessage,
  rememberedPlaceOf,
  rememberPlace,
  selectedNode,
} from '../../src/lib/view/node-selection'
import { NODE_BROWSER_MESSAGES } from './node-browser'
import { NodeSelector } from './node-selector'

/*
  The `astrale view` node selector: the Finder of `@astrale-os/ui` as a React island, fetched the
  first time a View asks for Nodes. It reads the graph through the page's Shell, as the session's
  caller, and the Shell confirms the chosen Nodes as that caller before the View receives them.
*/

export interface FinderIslandOptions {
  readonly requests: NodeSelectorRequests
  /** The page's own Kernel client: the caller, never a View's Domain credential. */
  readonly kernel: KernelClient
  /** The Domain origin of the window that asks, while it is open. */
  readonly askerOrigin: (sender: string) => string | undefined
  /** Where the next request opens: the last place of this identity on this instance. */
  readonly place: { readonly instance: string; readonly identity: string }
}

let mounted = false

/** Mount the node selector once; it shows whenever `requests` holds a request. */
export function mountFinderIsland(options: FinderIslandOptions): void {
  if (mounted) return
  mounted = true
  // The host page is dark; the Finder follows it, in its portals too.
  document.documentElement.classList.add('dark')
  const container = document.createElement('div')
  container.id = 'finder'
  document.body.append(container)
  const source = createGraphFinderSource(options.kernel)
  createRoot(container).render(
    <StrictMode>
      <FinderIsland options={options} source={source} />
    </StrictMode>,
  )
}

function FinderIsland({
  options,
  source,
}: {
  options: FinderIslandOptions
  source: FinderSource
}): ReactNode {
  const { requests } = options
  const pending = useSyncExternalStore(requests.subscribe, requests.getSnapshot)
  // The Shell cancels a request whose window closes; until it does, nothing shows.
  const askerOrigin = pending === null ? undefined : options.askerOrigin(pending.sender)
  if (pending === null || askerOrigin === undefined) return null
  return (
    <CancelOnFailure key={pending.id} pending={pending}>
      <Selector pending={pending} askerOrigin={askerOrigin} source={source} options={options} />
    </CancelOnFailure>
  )
}

function Selector({
  pending,
  askerOrigin,
  source,
  options,
}: {
  pending: PendingSelectNodes
  askerOrigin: string
  source: FinderSource
  options: FinderIslandOptions
}): ReactNode {
  const { request } = pending
  const { instance, identity } = options.place
  const asker = useDomainName(source, askerOrigin)
  const [defaultPlace] = useState(() => rememberedPlaceOf(browserStorage(), instance, identity))

  const confirm = async (choices: readonly FinderChoice[]) => {
    try {
      await pending.resolve(choices.map(selectedNode))
    } catch (error) {
      // The Finder keeps the choice and shows this message; the cause goes to the console.
      console.error('The Shell did not confirm the selection.', error)
      throw new Error(refusalMessage(error) ?? NODE_BROWSER_MESSAGES.confirmFailed, {
        cause: error,
      })
    }
  }

  return (
    <NodeSelector
      open
      source={source}
      maximum={request.maximum}
      {...(request.classes === undefined ? {} : { accepts: request.classes })}
      {...(request.title === undefined ? {} : { title: request.title })}
      description={`For ${asker ?? askerOrigin}`}
      {...(defaultPlace === undefined ? {} : { defaultPlace })}
      onPlaceChange={(place) => rememberPlace(browserStorage(), instance, identity, place)}
      theme="dark"
      className="font-sans text-foreground antialiased"
      onConfirm={confirm}
      onCancel={pending.cancel}
    />
  )
}

/** The asking Domain's name, once read; its origin until then, or when it cannot be read. */
function useDomainName(source: FinderSource, origin: string): string | undefined {
  const [name, setName] = useState<string>()
  useEffect(() => {
    const reading = new AbortController()
    source
      .domains({ signal: reading.signal })
      .then((domains) => {
        const domain = domains.find((item) => item.id === origin || item.origin === origin)
        if (domain !== undefined) setName(domain.name)
      })
      .catch(() => {})
    return () => reading.abort()
  }, [source, origin])
  return name
}

function browserStorage(): PlaceStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/**
 * A node selector that cannot render answers `cancelled`: the View never waits on a dialog that
 * will not show.
 */
class CancelOnFailure extends Component<
  { readonly pending: PendingSelectNodes; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    console.error('The node selector failed; the request is cancelled.', error)
    this.props.pending.cancel()
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
