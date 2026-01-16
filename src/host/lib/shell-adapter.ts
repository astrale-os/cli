/**
 * Browser Shell Adapter
 *
 * Manages iframe mounting/unmounting in the browser.
 */

export interface MountRequest {
  state: {
    nodeId: string
    iframe?: { src?: string; title?: string }
    name?: string
  }
  onWindowReady: (win: Window) => void
}

export interface MountResult {
  nodeId: string
  dispose: () => void
  update: (state: { title?: string }) => void
}

export interface ShellAdapter {
  mountIframe: (req: MountRequest) => Promise<MountResult>
  unmountIframe: (nodeId: string) => Promise<void>
  getIframeWindow: (nodeId: string) => Window | undefined
}

export interface IframeRef {
  element: HTMLIFrameElement
  onWindowReady: (win: Window) => void
}

/**
 * Creates a shell adapter that delegates iframe management to React.
 * The adapter stores callbacks that React components will use.
 */
export function createShellAdapter(
  iframeRefs: Map<string, IframeRef>,
  onMount: (nodeId: string, src: string, onWindowReady: (win: Window) => void) => void,
  onUnmount: (nodeId: string) => void,
): ShellAdapter {
  return {
    async mountIframe(req) {
      const { nodeId, iframe } = req.state
      const src = iframe?.src ?? ''

      // Store the callback for when React mounts the iframe
      onMount(nodeId, src, req.onWindowReady)

      return {
        nodeId,
        dispose: () => {
          iframeRefs.delete(nodeId)
          onUnmount(nodeId)
        },
        update: (state) => {
          const ref = iframeRefs.get(nodeId)
          if (ref && state.title) {
            ref.element.title = state.title
          }
        },
      }
    },

    async unmountIframe(nodeId) {
      iframeRefs.delete(nodeId)
      onUnmount(nodeId)
    },

    getIframeWindow(nodeId) {
      const ref = iframeRefs.get(nodeId)
      return ref?.element.contentWindow ?? undefined
    },
  }
}
