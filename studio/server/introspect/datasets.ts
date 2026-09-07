/**
 * datasets.ts — the demo Datasets a project references from `astrale.config.ts`.
 *
 * References are read STATICALLY from `defineProject` in the configuration (never executed), then each
 * module is extracted in its own Bun island (see dataset-extractor.ts) and projected into
 * the same node/edge shape the Core canvas renders. Never throws: every failure is data.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import type {
  StudioCoreEdge,
  StudioCoreNode,
  StudioDataset,
  StudioDatasetFailure,
  StudioDatasets,
  StudioSchemaBundle,
} from '../../shared/types'
import type { DomainHandle } from '../domain'

import { parseClassRefKey, parseSchemaRefKey, schemaRefKey } from '../../shared/types'
import { studioCliCommand } from '../cli'
import { analyzeProjectConfig, depsInstalled } from '../domain'
import { asJsonArray, asJsonRecord, asString, asStringArray, parseJson } from '../json'

const EXTRACTOR = new URL('./dataset-extractor.ts', import.meta.url).pathname

/** The portable Dataset bytes the SDK emits (`astrale.sdk.dataset` v1), structurally checked. */
export interface DatasetJson {
  id: string
  title?: string
  description?: string
  domain: { origin: string; revision: string }
  graph: {
    nodes: { id: string; class: string; props: Record<string, unknown> }[]
    edges: {
      source: string
      target: string
      class: string
      slug?: string
      props: Record<string, unknown>
    }[]
  }
  variables: Record<string, string[]>
  references: Record<string, string>
}

export type DatasetExtractResult =
  | { ok: true; dataset: DatasetJson }
  | { ok: false; error: { message: string } }

/** The Dataset module coordinates `astrale.config.ts` declares through `defineProject`, in order. */
export function datasetReferences(handle: DomainHandle): readonly string[] {
  return analyzeProjectConfig(handle.root).datasets
}

export function decodeDatasetJson(value: unknown): DatasetJson | undefined {
  const record = asJsonRecord(value)
  if (!record || record.format !== 'astrale.sdk.dataset' || record.version !== 1) return undefined
  const id = asString(record.id)
  const domain = asJsonRecord(record.domain)
  const origin = asString(domain?.origin)
  const revision = asString(domain?.revision)
  const graph = asJsonRecord(record.graph)
  const nodes = asJsonArray(graph?.nodes)
  const edges = asJsonArray(graph?.edges)
  const variables = asJsonRecord(record.variables)
  const references = asJsonRecord(record.references)
  if (!id || !origin || !revision || !nodes || !edges || !variables || !references) return undefined

  const decodedNodes: DatasetJson['graph']['nodes'] = []
  for (const entry of nodes) {
    const node = asJsonRecord(entry)
    const nodeId = asString(node?.id)
    const className = asString(node?.class)
    const props = asJsonRecord(node?.props)
    if (!nodeId || !className || !props) return undefined
    decodedNodes.push({ id: nodeId, class: className, props })
  }
  const decodedEdges: DatasetJson['graph']['edges'] = []
  for (const entry of edges) {
    const edge = asJsonRecord(entry)
    const source = asString(edge?.source)
    const target = asString(edge?.target)
    const className = asString(edge?.class)
    const props = asJsonRecord(edge?.props)
    const slug = asString(edge?.slug)
    if (!source || !target || !className || !props) return undefined
    decodedEdges.push({ source, target, class: className, props, ...(slug ? { slug } : {}) })
  }
  const decodedVariables: Record<string, string[]> = {}
  for (const [name, entry] of Object.entries(variables)) {
    const variable = asJsonRecord(entry)
    const one = asString(variable?.node)
    const many = asStringArray(variable?.nodes)
    if (one) decodedVariables[name] = [one]
    else if (many) decodedVariables[name] = many
    else return undefined
  }
  const decodedReferences: Record<string, string> = {}
  const nodeIds = new Set(decodedNodes.map(({ id }) => id))
  for (const [path, value] of Object.entries(references)) {
    if (typeof value !== 'string' || !nodeIds.has(value)) return undefined
    const ref = path.startsWith('/:') ? parseSchemaRefKey(path.slice(2)) : undefined
    if (!ref || /[/:\s]/u.test(ref.origin) || /[/:\s]/u.test(ref.name)) return undefined
    decodedReferences[schemaRefKey(ref)] = value
  }
  const title = asString(record.title)
  const description = asString(record.description)
  return {
    id,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    domain: { origin, revision },
    graph: { nodes: decodedNodes, edges: decodedEdges },
    variables: decodedVariables,
    references: decodedReferences,
  }
}

/** Spawn the Dataset extractor island for one module, from a neutral directory. */
export async function runtimeExtractDataset(
  modulePath: string,
  domainDir: string,
  timeoutMs = 60_000,
): Promise<DatasetExtractResult> {
  let launchDirectory: string | undefined
  try {
    launchDirectory = await mkdtemp(join(tmpdir(), 'astrale-studio-launch-'))
    let command: string[]
    try {
      command = studioCliCommand(['__studio-datasets', modulePath, domainDir])
    } catch {
      // Direct Studio development remains supported outside `astrale studio`.
      command = [process.execPath, EXTRACTOR, modulePath, domainDir]
    }
    const proc = Bun.spawn(command, { cwd: launchDirectory, stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => proc.kill(9), timeoutMs)
    const out = await new Response(proc.stdout).text()
    await proc.exited
    clearTimeout(timer)
    if (!out.trim()) {
      const err = await new Response(proc.stderr).text()
      return { ok: false, error: { message: err.trim() || 'dataset extractor produced no output' } }
    }
    const parsed = asJsonRecord(parseJson(out))
    if (!parsed) return { ok: false, error: { message: 'dataset extractor produced invalid JSON' } }
    if (parsed.ok !== true) {
      const message = asString(asJsonRecord(parsed.error)?.message) ?? 'dataset extraction failed'
      return { ok: false, error: { message } }
    }
    const dataset = decodeDatasetJson(parsed.dataset)
    if (!dataset) {
      return {
        ok: false,
        error: { message: 'dataset extractor produced an invalid Dataset envelope' },
      }
    }
    return { ok: true, dataset }
  } catch (e: unknown) {
    return { ok: false, error: { message: String((e as Error)?.message ?? e) } }
  } finally {
    if (launchDirectory !== undefined) {
      await rm(launchDirectory, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

/** Local Class name for the Dataset's own Schema; the exact key for imported Classes. */
function localClassName(key: string, origin: string): string {
  const ref = parseClassRefKey(key)
  return ref && ref.origin === origin ? ref.name : key
}

/** Project portable Dataset bytes into the Core canvas shape. */
export function projectDataset(
  path: string,
  dataset: DatasetJson,
  bundle: StudioSchemaBundle | null,
): StudioDataset {
  const origin = dataset.domain.origin
  const nodes: StudioCoreNode[] = dataset.graph.nodes.map((node) => ({
    path: node.id,
    className: localClassName(node.class, origin),
    data: node.props,
  }))
  const edges: StudioCoreEdge[] = dataset.graph.edges.map((edge) => ({
    from: edge.source,
    to: edge.target,
    edgeName: localClassName(edge.class, origin),
    ...(Object.keys(edge.props).length > 0 ? { data: edge.props } : {}),
  }))
  return {
    status: 'ready',
    path,
    id: dataset.id,
    ...(dataset.title ? { title: dataset.title } : {}),
    ...(dataset.description ? { description: dataset.description } : {}),
    origin,
    revision: dataset.domain.revision,
    schemaMatch: bundle?.schemaRevision === dataset.domain.revision,
    nodes,
    edges,
    variables: dataset.variables,
    references: dataset.references,
  }
}

/** Extract every referenced Dataset of one domain. Missing or broken modules become failures. */
export async function buildDatasets(
  handle: DomainHandle,
  bundle: StudioSchemaBundle | null,
  timeoutMs = 60_000,
): Promise<StudioDatasets> {
  const datasets: (StudioDataset | StudioDatasetFailure)[] = []
  const seen = new Map<string, string>()
  const installed = depsInstalled(handle.root)
  for (const path of datasetReferences(handle)) {
    const absolute = resolve(dirname(handle.configFile), path)
    if (!existsSync(absolute)) {
      datasets.push({
        status: 'failed',
        path,
        error: { message: `Dataset module not found at ${absolute}` },
      })
      continue
    }
    if (!installed) {
      datasets.push({
        status: 'failed',
        path,
        error: { message: 'dependencies not installed — run `pnpm install` in the domain' },
      })
      continue
    }
    const extracted = await runtimeExtractDataset(absolute, handle.root, timeoutMs)
    if (!extracted.ok) {
      datasets.push({ status: 'failed', path, error: extracted.error })
      continue
    }
    const previous = seen.get(extracted.dataset.id)
    if (previous !== undefined) {
      datasets.push({
        status: 'failed',
        path,
        error: { message: `Dataset id ${extracted.dataset.id} is already defined by ${previous}` },
      })
      continue
    }
    seen.set(extracted.dataset.id, path)
    datasets.push(projectDataset(path, extracted.dataset, bundle))
  }
  return { domainId: handle.id, datasets, extractedAt: new Date().toISOString() }
}
