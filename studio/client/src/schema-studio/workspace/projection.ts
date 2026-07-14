import type { DomainCatalogEntry } from '@shared/types'

import { MarkerType, type Edge, type Node } from '@xyflow/react'

import type { WorkspaceDomainInput } from './use-domain-inputs'

import { cardinalityMarkers } from '../cardinality-markers'
import { elkLayout } from '../elk-layout'
import { localEndpointTargets } from '../external'
import { applyGeometry, geometryOf, packPendingNodes, type Geometry } from '../geometry'
import { moduleOfClass } from '../modules'
import { localInterfaceRendered, projectDomainCanvas } from '../projection'
import { classRef, edgeRef, isHidden, type Materialized } from '../visibility'
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
  materialized: Materialized
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
  viaInterface: string | null
  unresolved?: WorkspaceExternalReference
}

const CROSS_COLOR = 'oklch(0.76 0.16 35)'
const CONTRACT_COLOR = 'oklch(0.72 0.18 330)'

export const workspaceDomainNodeId = (domainId: string) => `workspace-domain:${domainId}`
export const qualifiedNodeId = (domainId: string, localId: string) =>
  `workspace:${encodeURIComponent(domainId)}:${localId}`

function materializedInterfaces(
  input: WorkspaceDomainInput,
  badgeInterfaces: string[],
): Materialized {
  const badges = new Set(badgeInterfaces)
  return Object.fromEntries(
    Object.keys(input.bundle.ir?.interfaces ?? {})
      .filter((name) => !badges.has(name))
      .map((name) => [name, true]),
  )
}

/** Layout one domain independently, reusing its persisted geometry and only packing new nodes. */
export async function prepareWorkspaceDomain(
  input: WorkspaceDomainInput,
  collapsedModules: string[],
  badgeInterfaces: string[],
): Promise<WorkspaceDomainProjection> {
  const collapsed = new Set(collapsedModules)
  const materialized = materializedInterfaces(input, badgeInterfaces)
  const structure = projectDomainCanvas(
    input.bundle,
    collapsed,
    input.visibility.hidden,
    input.visibility.showInheritedEdges,
    materialized,
  )
  const saved = input.layout.positions
  const placed = structure.nodes.filter((node) => saved[node.id])
  const pending = structure.nodes.filter((node) => !saved[node.id])
  let geometry: Geometry

  if (pending.length === 0) {
    geometry = saved
  } else if (placed.length === 0) {
    geometry = geometryOf(await elkLayout(structure.nodes, structure.edges))
  } else {
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
    materialized,
    nodes: structure.nodes.map((node) => applyGeometry(node, geometry)),
    edges: structure.edges,
  }
}

function localTargets(domain: WorkspaceDomainProjection, type: string): ResolvedTarget[] {
  const ir = domain.input.bundle.ir
  if (!ir) return []
  const rendered = (name: string) =>
    localInterfaceRendered(domain.input.bundle, domain.collapsed, domain.materialized, name)
  return localEndpointTargets(ir, { types: [type] }, rendered)
    .filter(
      (target) => !target.cls || !isHidden(classRef(target.cls), domain.input.visibility.hidden),
    )
    .map((target) => {
      const localId = target.ifaceNode
        ? target.ifaceNode
        : domain.collapsed.has(moduleOfClass(domain.input.bundle, target.cls!))
          ? `grp-${moduleOfClass(domain.input.bundle, target.cls!)}`
          : `class.${target.cls}`
      return {
        nodeId: qualifiedNodeId(domain.input.summary.id, localId),
        domainId: domain.input.summary.id,
        className: target.cls,
        viaInterface: target.viaInterface,
      }
    })
}

function resolveType(
  owner: WorkspaceDomainProjection,
  type: string,
  origins: Map<string, WorkspaceDomainProjection[]>,
  diagnostics: Set<string>,
): ResolvedTarget[] {
  const ir = owner.input.bundle.ir
  if (!ir) return []
  if (ir.classes[type]?.type === 'node' || ir.interfaces[type]) return localTargets(owner, type)

  const imported = ir.imports[type]
  if (!imported) return []
  const candidates = origins.get(imported.origin) ?? []
  if (candidates.length > 1) {
    diagnostics.add(`Multiple selected folders declare ${imported.origin}; ${type} stays external.`)
  }
  if (candidates.length === 1) {
    const target = candidates[0]
    const targetIr = target.input.bundle.ir
    const exists =
      imported.definition === 'interface'
        ? !!targetIr?.interfaces[type]
        : targetIr?.classes[type]?.type === 'node'
    if (exists) return localTargets(target, type)
    diagnostics.add(
      `${owner.input.summary.origin} imports ${imported.origin}.${type}, but the selected schema does not expose it.`,
    )
  }

  return [
    {
      nodeId: workspaceExternalMemberNodeId(imported.origin, type),
      domainId: null,
      className: null,
      viaInterface: null,
      unresolved: { origin: imported.origin, name: type, definition: imported.definition },
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
      const aTargets = edgeClass.endpoints[0].types.flatMap((type) =>
        resolveType(owner, type, origins, diagnostics),
      )
      const bTargets = edgeClass.endpoints[1].types.flatMap((type) =>
        resolveType(owner, type, origins, diagnostics),
      )
      const cardinality = cardinalityMarkers(
        edgeClass.endpoints[0].cardinality,
        edgeClass.endpoints[1].cardinality,
      )

      for (const source of aTargets) {
        for (const target of bTargets) {
          const crossesDomain =
            source.domainId !== owner.input.summary.id || target.domainId !== owner.input.summary.id
          if (!crossesDomain || source.nodeId === target.nodeId) continue
          if (
            (source.viaInterface &&
              !domains.find((domain) => domain.input.summary.id === source.domainId)?.input
                .visibility.showInheritedEdges) ||
            (target.viaInterface &&
              !domains.find((domain) => domain.input.summary.id === target.domainId)?.input
                .visibility.showInheritedEdges)
          ) {
            continue
          }
          remember(source, owner.input.summary.id)
          remember(target, owner.input.summary.id)
          const id = edgeId(owner.input.summary.id, edgeClass.name, source.nodeId, target.nodeId)
          if (seen.has(id)) continue
          seen.add(id)
          const polymorphic = !!source.viaInterface || !!target.viaInterface
          edges.push({
            id,
            source: source.nodeId,
            target: target.nodeId,
            type: 'floating',
            data: {
              label: edgeClass.name,
              edgeClass: edgeClass.name,
              ownerDomainId: owner.input.summary.id,
              polymorphic,
            },
            markerStart: cardinality.markerStart,
            markerEnd: cardinality.markerEnd,
            style: {
              stroke: CROSS_COLOR,
              strokeWidth: 2.5,
              ...(polymorphic ? { strokeDasharray: '7 4' } : {}),
            },
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

function contractEdges(
  domains: WorkspaceDomainProjection[],
  origins: Map<string, WorkspaceDomainProjection[]>,
  diagnostics: Set<string>,
): Edge[] {
  const edges: Edge[] = []
  const seen = new Set<string>()
  const push = (edge: Edge) => {
    if (seen.has(edge.id)) return
    seen.add(edge.id)
    edges.push(edge)
  }

  for (const owner of domains) {
    const ir = owner.input.bundle.ir
    if (!ir) continue
    for (const [className, definition] of Object.entries(ir.classes)) {
      if (definition.type !== 'node') continue
      const source = localTargets(owner, className)[0]
      if (!source) continue
      for (const interfaceName of definition.implements ?? []) {
        const imported = ir.imports[interfaceName]
        if (!imported || imported.origin === 'kernel.astrale.ai') continue
        for (const target of resolveType(owner, interfaceName, origins, diagnostics)) {
          if (target.unresolved) continue
          const id = `workspace-implements:${source.nodeId}:${target.nodeId}`
          push({
            id,
            source: source.nodeId,
            target: target.nodeId,
            type: 'floating',
            data: { kind: 'implements', ownerDomainId: owner.input.summary.id },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: CONTRACT_COLOR,
              width: 16,
              height: 16,
            },
            style: { stroke: CONTRACT_COLOR, strokeWidth: 1.7, strokeDasharray: '7 4' },
          })
        }
      }
    }

    for (const interfaceName of Object.keys(ir.interfaces)) {
      const source = localTargets(owner, interfaceName)[0]
      if (!source) continue
      for (const parent of ir.interfaces[interfaceName]?.extends ?? []) {
        const imported = ir.imports[parent]
        if (!imported || imported.origin === 'kernel.astrale.ai') continue
        for (const target of resolveType(owner, parent, origins, diagnostics)) {
          if (target.unresolved) continue
          const id = `workspace-extends:${source.nodeId}:${target.nodeId}`
          push({
            id,
            source: source.nodeId,
            target: target.nodeId,
            type: 'floating',
            data: { label: 'extends', kind: 'extends', ownerDomainId: owner.input.summary.id },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: CONTRACT_COLOR,
              width: 16,
              height: 16,
            },
            style: { stroke: CONTRACT_COLOR, strokeWidth: 1.7, strokeDasharray: '2 4' },
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
    const list = origins.get(origin) ?? []
    list.push(domain)
    origins.set(origin, list)
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
        memberCount:
          Object.keys(domain.input.bundle.ir?.classes ?? {}).length +
          Object.keys(domain.input.bundle.ir?.interfaces ?? {}).length,
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
        style: {
          ...node.style,
          ...(active ? {} : { pointerEvents: 'none' }),
        },
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
  const contracts = contractEdges(domains, origins, diagnostics)
  const externals = projectExternalFrames(cross.unresolved, frames, externalPositions, catalog)
  nodes.push(...externals.nodes)
  edges.push(...cross.edges, ...contracts)

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
