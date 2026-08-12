import type { GraphQueryOptions, NeighborsOptions, NodePage } from '@astrale-os/kernel-client/graph'
import type { ClassPath } from '@astrale-os/kernel-core/graph/class'
import type { Node } from '@astrale-os/kernel-core/graph/node'
import type { QueryAST, QueryResult } from '@astrale-os/kernel-core/graph/query'
import type { PathLike } from '@astrale-os/kernel-core/path'

export interface AdminGraphQueryApi {
  query(ast: QueryAST, options?: GraphQueryOptions): Promise<QueryResult>
}

export interface AdminGraphApi extends AdminGraphQueryApi {
  neighbors(source: PathLike, edge: ClassPath, options: NeighborsOptions): Promise<NodePage>
}

export interface ReadAllNodesOptions {
  readonly label: string
  readonly maximum: number
  readonly maximumPages: number
}

/** Collect one explicitly bounded Node-value projection without hiding cursors. */
export async function readAllNodes(
  graph: AdminGraphQueryApi,
  ast: QueryAST,
  options: ReadAllNodesOptions,
): Promise<readonly Node[]> {
  const nodes: Node[] = []
  const ids = new Set<string>()
  const cursors = new Set<string>()
  let cursor: string | undefined
  let pages = 0
  do {
    pages += 1
    if (pages > options.maximumPages) {
      throw new TypeError(`${options.label} exceeded its page bound.`)
    }
    const result = await graph.query(ast, cursor === undefined ? undefined : { cursor })
    if (result.kind !== 'node')
      throw new TypeError(`${options.label} returned the wrong projection.`)
    for (const projection of result.nodes) {
      if (projection.kind !== 'value') {
        throw new TypeError(`${options.label} omitted requested Node values.`)
      }
      const node = projection.value
      if (ids.has(String(node.id))) throw new TypeError(`${options.label} repeated a Node.`)
      ids.add(String(node.id))
      nodes.push(node)
    }
    if (nodes.length > options.maximum) {
      throw new TypeError(`${options.label} exceeded its Node bound.`)
    }
    cursor = result.cursor
    if (cursor !== undefined && cursors.has(cursor)) {
      throw new TypeError(`${options.label} repeated a cursor.`)
    }
    if (cursor !== undefined) cursors.add(cursor)
  } while (cursor !== undefined)
  return Object.freeze(nodes)
}
