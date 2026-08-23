import type { GraphApi } from '@astrale-os/kernel-client/graph'
import type { Node } from '@astrale-os/sdk/graph/node'
import type { QueryAST } from '@astrale-os/sdk/query'

/** Smallest Kernel graph capability needed by bounded Admin graph reads. */
export type AdminGraphQueryApi = Pick<GraphApi, 'query'>

/** Caller-scoped graph reads shared by the Admin catalog and Instance journeys. */
export type AdminGraphApi = Pick<GraphApi, 'query' | 'neighbors'>

export interface ReadAllNodesOptions {
  readonly label: string
  readonly maximum: number
  readonly maximumPages: number
}

/** Collect one bounded Node selection and reject projection, cursor, or identity anomalies. */
export function readAllNodes(
  graph: AdminGraphQueryApi,
  ast: QueryAST,
  options: ReadAllNodesOptions,
): Promise<readonly Node[]>
