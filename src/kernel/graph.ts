import type {
  GetResultWire,
  GraphApi,
  GraphNodeWire,
  MutationResultWire,
  PatchInput,
  QueryASTInput,
} from '@astrale-os/kernel-client/graph'

import { createGraph, rawOf } from '@astrale-os/kernel-client/graph'

import type { ClientContext } from './client'

export type {
  GetResultWire,
  GraphApi,
  GraphNodeWire,
  MutationResultWire,
  PatchInput,
  QueryASTInput,
}

/** A node row as it crosses the graph doors — the shared item shape for `get`/`ls`/`describe`. */
export type GraphNode = GraphNodeWire

/**
 * Bind the graph sugar (`function.get` / `function.mutate` + the read/write
 * helpers) over a CLI client session. The sugar is pure over a call capability;
 * we hand it `ClientSession.call` — the same surface every command already uses.
 */
export function bindGraph(ctx: ClientContext): GraphApi {
  return createGraph((method, params) => ctx.client.call(method, params))
}

/**
 * Split a depth≥1 `function.get` node page into the addressed root node and the
 * remaining descendants — the ONE place a `GraphData` page becomes rows for the
 * `ls` / `describe` projections (replaces the old `extractItems`).
 *
 * The root matches by absolute path (`rawOf`) or, when addressed by `@id`, by
 * node id; failing both it falls back to the shallowest node (a root is strictly
 * shallower than its own descendants within one page).
 */
export function splitRoot(
  nodes: readonly GraphNode[],
  rootPath: string,
): { root: GraphNode | undefined; children: GraphNode[] } {
  const raw = rawOf(rootPath)
  const idForm = rootPath.startsWith('@') ? rootPath.slice(1) : undefined

  let idx = nodes.findIndex(
    (n) => rawOf(n.path) === raw || (idForm !== undefined && n.id === idForm),
  )
  if (idx < 0 && nodes.length > 0) {
    let min = Number.POSITIVE_INFINITY
    nodes.forEach((n, i) => {
      const depth = rawOf(n.path).split('/').length
      if (depth < min) {
        min = depth
        idx = i
      }
    })
  }

  const root = idx >= 0 ? nodes[idx] : undefined
  const children = idx >= 0 ? nodes.filter((_, i) => i !== idx) : [...nodes]
  return { root, children }
}

/** The children cursor of a single-root `function.get` result, if the page overflowed. */
export function childrenCursor(result: GetResultWire): string | undefined {
  const next = result.next
  if (!next) return undefined
  return Object.values(next)[0]?.children
}

/**
 * Strip a fully-qualified prop key to its leaf name. Node props travel under
 * qualified keys (`<domain>:class.X.property.name` / `<domain>:interface.I.property.name`);
 * this recovers `name`.
 */
export function unqualifyKey(key: string): string {
  const dot = key.lastIndexOf('.property.')
  if (dot >= 0) return key.slice(dot + '.property.'.length)
  const slash = key.lastIndexOf('/')
  return slash >= 0 ? key.slice(slash + 1) : key
}

/** Read a node prop by its unqualified leaf name (exact key wins, else a qualified match). */
export function nodeProp(
  node: { props: Record<string, unknown> } | null | undefined,
  name: string,
): unknown {
  const props = node?.props
  if (!props) return undefined
  if (name in props) return props[name]
  for (const [k, v] of Object.entries(props)) {
    if (unqualifyKey(k) === name) return v
  }
  return undefined
}
