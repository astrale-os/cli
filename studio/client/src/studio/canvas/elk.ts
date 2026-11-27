/**
 * The browser's layout engine: ELK in a Web Worker, so laying out a large Domain never
 * blocks a frame. One worker serves every canvas; it starts on first use.
 */

import type { ELK } from 'elkjs/lib/elk-api.js'

import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url'

import type { LayoutEngine } from './layout'

let engine: Promise<ELK> | undefined

export const workerEngine: LayoutEngine = {
  layout: async (graph) => {
    engine ??= import('elkjs/lib/elk-api.js').then(
      ({ default: ElkConstructor }) => new ElkConstructor({ workerUrl: elkWorkerUrl }),
    )
    return (await engine).layout(graph)
  },
}
