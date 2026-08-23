import type { DomainCatalogEntry, IrClassRef, IrEndpoint } from '@shared/types'

import { isIrClassRef } from '@shared/schema/identity'
import { MarkerType, type Edge, type Node } from '@xyflow/react'

import type { WorkspaceDomainInput } from './use-domain-inputs'

import { cardinalityMarkers } from '../cardinality-markers'
import { elkLayout } from '../elk-layout'
import { applyGeometry, geometryOf, packPendingNodes, type Geometry } from '../geometry'
import { moduleOfClass } from '../modules'
import { projectDomainCanvas } from '../projection'
import { classRef, edgeRef, isHidden } from '../visibility'
import {
  projectExternalFrames,
  workspaceExternalMemberNodeId,
  type WorkspaceExternalCluster,
  type WorkspaceExternalReference,
} from './external-frames'
import {
  layoutWorkspaceFrames,
  type WorkspaceNodeGeometryData,
  type WorkspacePoint,
  type WorkspaceSize,
} from './geometry'

export interface WorkspaceDomainProjection {
  input: WorkspaceDomainInput
  collapsed: Set<string>
  nodes: Node[]
  edges: Edge[]
}

export interface WorkspaceDomainNodeData extends Record<string, unknown> {
  domainId: string
  origin: string
  memberCount: number
  active: boolean
}

export interface WorkspaceProjection {
  nodes: Node[]
  edges: Edge[]
  diagnostics: string[]
  domainPositions: Record<string, WorkspacePoint>
  externalPositions: Record<string, WorkspacePoint>
  contentOffsets: Record<string, WorkspacePoint>
}

export interface ComposeWorkspaceCanvasOptions {
  activeDomainId: string
  domainPositions?: Record<string, WorkspacePoint>
  externalPositions?: Record<string, WorkspacePoint>
  contentOffsets?: Record<string, WorkspacePoint>
  domainSizes?: Record<string, WorkspaceSize>
  catalog?: DomainCatalogEntry[]
}

interface ResolvedTarget {
  nodeId: string
  domainId: string | null
  className: string | null
  unresolved?: WorkspaceExternalReference
}

const CROSS_COLOR = 'oklch(0.76 0.16 35)'
const INHERITANCE_COLOR = 'oklch(0.72 0.18 330)'

export const workspaceDomainNodeId = (domainId: string) => `workspace-domain:${domainId}`
export const qualifiedNodeId = (domainId: string, localId: string) =>
  `workspace:${encodeURIComponent(domainId)}:${localId}`

/** Layout one Domain independently, reusing persisted geometry and packing only new nodes. */
export async function prepareWorkspaceDomain(
  input: WorkspaceDomainInput,
  collapsedModules: string[],
): Promise<WorkspaceDomainProjection> {
  const collapsed = new Set(collapsedModules)
  const structure = projectDomainCanvas(
    input.bundle,
    collapsed,
    input.visibility.hidden,
    input.visibility.showInheritedEdges,
  )
  const saved = input.layout.positions
  const placed = structure.nodes.filter((node) => saved[node.id])
  const pending = structure.nodes.filter((node) => !saved[node.id])
  let geometry: Geometry

  if (pending.length === 0) geometry = saved
  else if (placed.length === 0)
    geometry = geometryOf(await elkLayout(structure.nodes, structure.edges))
  else {
    geometry = {
      ...saved,
      ...packPendingNodes(
        placed.map((node) => ({ node, position: saved[node.id] })),
        pending,
      ),
    }
  }

  return {
    input,
    collapsed,
    nodes: structure.nodes.map((node) => applyGeometry(node, geometry)),
    edges: structure.edges,
  }
}

function endpointClasses(endpoint: IrEndpoint): Array<string | IrClassRef> {
  return endpoint.refs !== undefined ? endpoint.refs.filter(isIrClassRef) : endpoint.types
}

function localTarget(domain: WorkspaceDomainProjection, name: string): ResolvedTarget | undefined {
  const ir = domain.input.bundle.ir
  if (!ir || ir.classes[name]?.type !== 'node') return undefined
  if (isHidden(classRef(name), domain.input.visibility.hidden)) return undefined
  const modulePath = moduleOfClass(domain.input.bundle, name)
  const localId = domain.collapsed.has(modulePath) ? `grp-${modulePath}` : `class.${name}`
  return {
    nodeId: qualifiedNodeId(domain.input.summary.id, localId),
    domainId: domain.input.summary.id,
    className: name,
  }
}

function importedClassRef(owner: WorkspaceDomainProjection, name: string): IrClassRef | undefined {
  const ir = owner.input.bundle.ir
  if (!ir) return undefined
  return Object.values(ir.importsByKey).find((descriptor) => descriptor.ref.name === name)?.ref
}

function resolveClass(
  owner: WorkspaceDomainProjection,
  input: string | IrClassRef,
  origins: Map<string, WorkspaceDomainProjection[]>,
  diagnostics: Set<string>,
): ResolvedTarget[] {
  const ir = owner.input.bundle.ir
  if (!ir) return []
  const ref: IrClassRef =
    typeof input === 'string'
      ? (importedClassRef(owner, input) ?? { origin: ir.domain, kind: 'class', name: input })
      : input

  if (ref.origin === ir.domain) {
    const target = localTarget(owner, ref.name)
    return target ? [target] : []
  }

  const candidates = origins.get(ref.origin) ?? []
  if (candidates.length > 1) {
    diagnostics.add(`Multiple selected folders declare ${ref.origin}; ${ref.name} stays external.`)
  }
  if (candidates.length === 1) {
    const target = localTarget(candidates[0], ref.name)
    if (target) return [target]
    diagnostics.add(
      `${owner.input.summary.origin} imports ${ref.origin}:class.${ref.name}, but the selected schema does not expose it.`,
    )
  }

  return [
    {
      nodeId: workspaceExternalMemberNodeId(ref.origin, ref.name, 'class'),
      domainId: null,
      className: null,
      unresolved: { origin: ref.origin, name: ref.name, definition: 'class' },
    },
  ]
}

function edgeId(ownerId: string, name: string, source: string, target: string): string {
  return `workspace-edge:${encodeURIComponent(ownerId)}:${name}:${source}:${target}`
}

function crossDomainEdges(
  domains: WorkspaceDomainProjection[],
  origins: Map<string, WorkspaceDomainProjection[]>,
  diagnostics: Set<string>,
): { edges: Edge[]; unresolved: WorkspaceExternalCluster[] } {
  const edges: Edge[] = []
  const unresolved = new Map<
    string,
    { members: Map<string, WorkspaceExternalReference>; ownerDomainIds: Set<string> }
  >()
  const seen = new Set<string>()

  const remember = (target: ResolvedTarget, ownerDomainId: string) => {
    if (!target.unresolved) return
    const cluster = unresolved.get(target.unresolved.origin) ?? {
      members: new Map(),
      ownerDomainIds: new Set(),
    }
    cluster.members.set(target.unresolved.name, target.unresolved)
    cluster.ownerDomainIds.add(ownerDomainId)
    unresolved.set(target.unresolved.origin, cluster)
  }

  for (const owner of domains) {
    const ir = owner.input.bundle.ir
    if (!ir) continue
    for (const edgeClass of Object.values(ir.classes)) {
      if (edgeClass.type !== 'edge' || edgeClass.endpoints?.length !== 2) continue
      if (isHidden(edgeRef(edgeClass.name), owner.input.visibility.hidden)) continue
      const sources = endpointClasses(edgeClass.endpoints[0]).flatMap((input) =>
        resolveClass(owner, input, origins, diagnostics),
      )
      const targets = endpointClasses(edgeClass.endpoints[1]).flatMap((input) =>
        resolveClass(owner, input, origins, diagnostics),
      )
      const cardinality = cardinalityMarkers(
        edgeClass.endpoints[0].cardinality,
        edgeClass.endpoints[1].cardinality,
      )
      for (const source of sources) {
        for (const target of targets) {
          const crossesDomain =
            source.domainId !== owner.input.summary.id || target.domainId !== owner.input.summary.id
          if (!crossesDomain || source.nodeId === target.nodeId) continue
          remember(source, owner.input.summary.id)
          remember(target, owner.input.summary.id)
          const id = edgeId(owner.input.summary.id, edgeClass.name, source.nodeId, target.nodeId)
          if (seen.has(id)) continue
          seen.add(id)
          edges.push({
            id,
            source: source.nodeId,
            target: target.nodeId,
            type: 'floating',
            data: {
              label: edgeClass.name,
              edgeClass: edgeClass.name,
              ownerDomainId: owner.input.summary.id,
            },
            markerStart: cardinality.markerStart,
            markerEnd: cardinality.markerEnd,
            style: { stroke: CROSS_COLOR, strokeWidth: 2.5 },
          })
        }
      }
    }
  }

  return {
    edges,
    unresolved: [...unresolved.entries()].map(([origin, cluster]) => ({
      origin,
      members: [...cluster.members.values()].sort((a, b) => a.name.localeCompare(b.name)),
      ownerDomainIds: [...cluster.ownerDomainIds],
    })),
  }
}

function inheritanceEdges(
  domains: WorkspaceDomainProjection[],
  origins: Map<string, WorkspaceDomainProjection[]>,
  diagnostics: Set<string>,
): Edge[] {
  const edges: Edge[] = []
  const seen = new Set<string>()
  for (const owner of domains) {
    const ir = owner.input.bundle.ir
    if (!ir || !owner.input.visibility.showInheritedEdges) continue
    for (const [className, definition] of Object.entries(ir.classes)) {
      if (definition.type !== 'node') continue
      const source = localTarget(owner, className)
      if (!source) continue
      for (const parent of definition.extendsRefs ?? []) {
        for (const target of resolveClass(owner, parent, origins, diagnostics)) {
          if (target.unresolved || target.nodeId === source.nodeId) continue
          const id = `workspace-extends:${source.nodeId}:${target.nodeId}`
          if (seen.has(id)) continue
          seen.add(id)
          edges.push({
            id,
            source: source.nodeId,
            target: target.nodeId,
            type: 'floating',
            data: { label: 'extends', kind: 'extends', ownerDomainId: owner.input.summary.id },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: INHERITANCE_COLOR,
              width: 16,
              height: 16,
            },
            style: {
              stroke: INHERITANCE_COLOR,
              strokeWidth: 1.7,
              strokeDasharray: '2 4',
            },
          })
        }
      }
    }
  }
  return edges
}

export function composeWorkspaceCanvas(
  domains: WorkspaceDomainProjection[],
  {
    activeDomainId,
    domainPositions = {},
    externalPositions = {},
    contentOffsets = {},
    domainSizes = {},
    catalog,
  }: ComposeWorkspaceCanvasOptions,
): WorkspaceProjection {
  const diagnostics = new Set<string>()
  const origins = new Map<string, WorkspaceDomainProjection[]>()
  for (const domain of domains) {
    const origin = domain.input.bundle.ir?.domain ?? domain.input.summary.origin
    origins.set(origin, [...(origins.get(origin) ?? []), domain])
  }

  const frames = layoutWorkspaceFrames(
    domains.map((domain) => ({ domainId: domain.input.summary.id, nodes: domain.nodes })),
    domainPositions,
    domainSizes,
    contentOffsets,
  )
  const framesByDomain = new Map(frames.map((frame) => [frame.domainId, frame]))
  const nodes: Node[] = []
  const edges: Edge[] = []

  for (const domain of domains) {
    const domainId = domain.input.summary.id
    const frame = framesByDomain.get(domainId)!
    const rootId = workspaceDomainNodeId(domainId)
    const active = domainId === activeDomainId
    nodes.push({
      id: rootId,
      type: 'workspaceDomain',
      position: frame.position,
      draggable: true,
      dragHandle: '.workspace-domain-drag-handle',
      selectable: true,
      data: {
        domainId,
        origin: domain.input.summary.origin,
        memberCount: Object.keys(domain.input.bundle.ir?.classes ?? {}).length,
        active,
      } satisfies WorkspaceDomainNodeData,
      style: { width: frame.size.width, height: frame.size.height },
    })

    for (const node of domain.nodes) {
      const root = !node.parentId
      const offset = root ? frame.contentOffset : { x: 0, y: 0 }
      nodes.push({
        ...node,
        id: qualifiedNodeId(domainId, node.id),
        parentId: root ? rootId : qualifiedNodeId(domainId, node.parentId!),
        position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
        data: {
          ...node.data,
          workspaceGeometry: {
            domainId,
            localId: node.id,
            offset,
            active,
          } satisfies WorkspaceNodeGeometryData,
        },
        extent: 'parent',
        expandParent: false,
        draggable: active,
        selectable: active,
        focusable: active,
        style: { ...node.style, ...(active ? {} : { pointerEvents: 'none' }) },
      })
    }
    for (const edge of domain.edges) {
      edges.push({
        ...edge,
        id: qualifiedNodeId(domainId, edge.id),
        source: qualifiedNodeId(domainId, edge.source),
        target: qualifiedNodeId(domainId, edge.target),
      })
    }
  }

  const cross = crossDomainEdges(domains, origins, diagnostics)
  const inheritance = inheritanceEdges(domains, origins, diagnostics)
  const externals = projectExternalFrames(cross.unresolved, frames, externalPositions, catalog)
  nodes.push(...externals.nodes)
  edges.push(...cross.edges, ...inheritance)

  return {
    nodes,
    edges,
    diagnostics: [...diagnostics].sort(),
    domainPositions: Object.fromEntries(frames.map((frame) => [frame.domainId, frame.position])),
    externalPositions: externals.positions,
    contentOffsets: Object.fromEntries(
      frames.map((frame) => [frame.domainId, frame.contentOffset]),
    ),
  }
}
