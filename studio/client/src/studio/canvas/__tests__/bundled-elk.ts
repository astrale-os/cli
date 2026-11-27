import type { ElkNode } from 'elkjs/lib/elk-api.js'

import ELK from 'elkjs/lib/elk.bundled.js'

import type { LayoutEngine } from '../layout'

/** ELK's bundled build, in-process: it reads a global `self` as "I am a worker" if one exists. */
export function bundledElk(): LayoutEngine {
  const scope = globalThis as { self?: unknown }
  const saved = scope.self
  delete scope.self
  const elk = new ELK()
  scope.self = saved
  return { layout: (graph: ElkNode) => elk.layout(graph) }
}
