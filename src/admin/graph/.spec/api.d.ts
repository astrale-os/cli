import type { GraphQueryOptions, NeighborsOptions, NodePage } from '@astrale-os/kernel-client/graph'
import type { ClassPath } from '@astrale-os/sdk/graph/class'
import type { Node } from '@astrale-os/sdk/graph/node'
import type { PathLike } from '@astrale-os/sdk/graph/path'
import type { QueryAST, QueryResult } from '@astrale-os/sdk/query'

/** Smallest Kernel graph capability needed by bounded Admin graph reads. */
export interface AdminGraphQueryApi {
  query(ast: QueryAST, options?: GraphQueryOptions): Promise<QueryResult>
}

/** Caller-scoped graph reads shared by the Admin catalog and Instance journeys. */
export interface AdminGraphApi extends AdminGraphQueryApi {
  neighbors(source: PathLike, edge: ClassPath, options: NeighborsOptions): Promise<NodePage>
}

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
