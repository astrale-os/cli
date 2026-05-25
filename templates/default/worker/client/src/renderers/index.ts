import type { Shell } from '@astrale-os/shell'
import type { ComponentType } from 'react'

import { DefaultRenderer } from './default'

export type RendererProps = {
  shell: Shell | null
  nodeId: string | undefined
}

export type Renderer = ComponentType<RendererProps>

/**
 * Registry of renderers, keyed by URL slug (`/ui/<slug>`). Add a view:
 *   1. create `./<slug>.tsx` exporting a React component `{shell, nodeId}`.
 *   2. register it here.
 *   3. seed a `View` node in the kernel graph with `url:
 *      '<WORKER_URL>/ui/<slug>'` + the `view_for` edge.
 *
 * The `/$slug` route looks up by the incoming URL slug — unknown slugs
 * render a 404.
 */
export const RENDERERS: Record<string, Renderer> = {
  // Keyed by the `/ui/<slug>` segment. The `ui-note` View redirects to
  // `/ui/note` (see worker/src/index.ts), so the renderer lives under `note`.
  note: DefaultRenderer,
}
