import { KernelClient, type FnMap } from '@astrale-os/kernel-client'
import {
  FalkorDBAdapter,
  listGraphs,
  deleteGraph,
  type FalkorDBConfig,
} from '@astrale/typegraph-adapter-falkordb'
import chalk from 'chalk'

import type { AstraleConfig } from './config'

import { resolveCredential } from '../kernel/auth'
import { log } from './log'

// ─── Types ──────────────────────────────────────────────────

export type GraphStatus = 'in-use' | 'orphaned' | 'manager' | 'unknown'

export type GraphStats = { nodes: number; edges: number } | null

export type GraphInfo = {
  name: string
  /** null means stats could not be retrieved (connection error, etc.) */
  stats: GraphStats
  status: GraphStatus
  instance: string | null
}

export type GraphSummary = {
  total: number
  inUse: number
  orphaned: number
  unknown: number
}

type KernelInstance = {
  id: string
  graphName: string
  status: string
}

const GRAPH_NAME_RE = /^[a-zA-Z0-9_-]+$/

// ─── Validation ─────────────────────────────────────────────

export function validateGraphName(name: string): void {
  if (!name || !GRAPH_NAME_RE.test(name)) {
    throw new Error(
      `Invalid graph name "${name}" — must contain only letters, digits, hyphens, and underscores`,
    )
  }
}

// ─── FalkorDB operations ───────────────────────────────────

function falkorConfig(config: AstraleConfig, graphName = 'temp'): FalkorDBConfig {
  return { graphName, host: 'localhost', port: config.falkorPort }
}

/** List all graph names from FalkorDB. */
export async function getAllGraphs(config: AstraleConfig): Promise<string[]> {
  return listGraphs({ host: 'localhost', port: config.falkorPort })
}

/** Query node + edge counts for a single graph. Returns null on error. */
export async function getGraphStats(config: AstraleConfig, graphName: string): Promise<GraphStats> {
  const adapter = new FalkorDBAdapter(falkorConfig(config, graphName))
  try {
    await adapter.connect()
    const [nodeResult] = await adapter.query<{ count: number }>(
      'MATCH (n) RETURN count(n) AS count',
    )
    const [edgeResult] = await adapter.query<{ count: number }>(
      'MATCH ()-[r]->() RETURN count(r) AS count',
    )
    return {
      nodes: nodeResult?.count ?? 0,
      edges: edgeResult?.count ?? 0,
    }
  } catch {
    return null
  } finally {
    await adapter.close()
  }
}

/** Delete a graph from FalkorDB. */
export async function removeGraph(config: AstraleConfig, graphName: string): Promise<void> {
  validateGraphName(graphName)
  await deleteGraph(falkorConfig(config, graphName))
}

// ─── Instance discovery ────────────────────────────────────

/** Try to fetch instance list from the manager. Returns null if unreachable. */
async function discoverInstances(config: AstraleConfig): Promise<KernelInstance[] | null> {
  const url = `http://localhost:${config.managerPort}/mngt`
  const client = new KernelClient<FnMap>({ url, requestTimeout: 5_000 })
  try {
    const credential = await resolveCredential({}, config)
    const result = await client.call('/manager.astrale.ai/KernelInstance/list', {}, credential)
    return result as KernelInstance[]
  } catch {
    return null
  } finally {
    client.disconnect()
  }
}

// ─── Graph status resolution ───────────────────────────────

/**
 * Build the full GraphInfo[] by joining FalkorDB graphs with kernel instances.
 *
 * This is the core operation: for each graph in FalkorDB, determine whether
 * it's the manager graph, attached to a running instance, or orphaned.
 */
export async function resolveGraphStatuses(config: AstraleConfig): Promise<{
  graphs: GraphInfo[]
  summary: GraphSummary
  managerReachable: boolean
}> {
  const [graphNames, instances] = await Promise.all([
    getAllGraphs(config),
    discoverInstances(config),
  ])
  const managerReachable = instances !== null

  // Build instance-to-graph lookup
  const graphToInstance = new Map<string, KernelInstance>()
  if (instances) {
    for (const inst of instances) {
      graphToInstance.set(inst.graphName, inst)
    }
  }

  // Fetch stats for all graphs in parallel
  const statsResults = await Promise.all(graphNames.map((name) => getGraphStats(config, name)))

  // Assemble GraphInfo[]
  const graphs: GraphInfo[] = graphNames.map((name, i) => {
    const status = classifyGraph(name, config.graphName, graphToInstance, managerReachable)
    const instance = graphToInstance.get(name)
    return {
      name,
      stats: statsResults[i],
      status,
      instance: name === config.graphName ? 'manager' : (instance?.id ?? null),
    }
  })

  const summary: GraphSummary = {
    total: graphs.length,
    inUse: graphs.filter((g) => g.status === 'in-use' || g.status === 'manager').length,
    orphaned: graphs.filter((g) => g.status === 'orphaned').length,
    unknown: graphs.filter((g) => g.status === 'unknown').length,
  }

  return { graphs, summary, managerReachable }
}

/** Classify a single graph's status. */
export function classifyGraph(
  graphName: string,
  managerGraphName: string,
  graphToInstance: Map<string, KernelInstance>,
  managerReachable: boolean,
): GraphStatus {
  if (graphName === managerGraphName) return 'manager'
  if (graphToInstance.has(graphName)) return 'in-use'
  if (!managerReachable) return 'unknown'
  return 'orphaned'
}

// ─── Shared formatting ─────────────────────────────────────

export function colorStatus(status: string): string {
  switch (status) {
    case 'in-use':
      return chalk.green(status)
    case 'manager':
      return chalk.blue(status)
    case 'orphaned':
      return chalk.yellow(status)
    case 'unknown':
      return chalk.dim(status)
    default:
      return status
  }
}

export function formatStats(stats: GraphStats): { nodes: string; edges: string } {
  if (stats === null) return { nodes: '?', edges: '?' }
  return { nodes: String(stats.nodes), edges: String(stats.edges) }
}

export function handleGraphError(e: unknown): void {
  if (e instanceof Error && e.message.includes('ECONNREFUSED')) {
    log.dim('  Is FalkorDB running? Try: astrale status')
  }
}
