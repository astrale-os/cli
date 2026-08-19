import type { GraphApi } from '@astrale-os/kernel-client/graph'
import type { Node } from '@astrale-os/sdk/graph/node'
import type { QueryAST } from '@astrale-os/sdk/query'

export type AdminGraphQueryApi = Pick<GraphApi, 'query'>
export type AdminGraphApi = Pick<GraphApi, 'query' | 'neighbors'>

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
  const pageSize = Math.min(options.maximum, 256)
  do {
    pages += 1
    if (pages > options.maximumPages) {
      throw new TypeError(`${options.label} exceeded its page bound.`)
    }
    const response = await graph.query(ast, {
      page: { size: pageSize, ...(cursor === undefined ? {} : { after: cursor }) },
    })
    const result = response.result
    if (result.kind !== 'nodes')
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
    cursor = response.page.next
    if (cursor !== undefined && cursors.has(cursor)) {
      throw new TypeError(`${options.label} repeated a cursor.`)
    }
    if (cursor !== undefined) cursors.add(cursor)
  } while (cursor !== undefined)
  return Object.freeze(nodes)
}
