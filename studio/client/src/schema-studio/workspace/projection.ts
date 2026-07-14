import type { DomainCatalogEntry, NodePosition } from '@shared/types'

import { MarkerType, type Edge, type Node } from '@xyflow/react'

import type { WorkspaceSize } from './store'
import type { WorkspaceDomainInput } from './use-domain-inputs'

import { cardinalityMarkers } from '../cardinality-markers'
import { elkLayout } from '../elk-layout'
import { localEndpointTargets } from '../external'
import { applyGeometry, geometryOf, packPendingNodes, type Geometry } from '../geometry'
import { moduleOfClass } from '../modules'
import { localInterfaceRendered, projectDomainCanvas } from '../projection'
import { classRef, edgeRef, isHidden, type Materialized } from '../visibility'

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
  minWidth: number
  minHeight: number
}

export interface WorkspaceProjection {
  nodes: Node[]
  edges: Edge[]
  diagnostics: string[]
  contentOffsets: Record<string, NodePosition>
}

export interface WorkspaceNodeGeometryData {
  domainId: string
  localId: string
  offset: NodePosition
  active: boolean
  minWidth?: number
  minHeight?: number
}

interface ResolvedTarget {
  nodeId: string
  domainId: string | null
  className: string | null
  viaInterface: string | null
  unresolved?: { origin: string; name: string; definition: 'class' | 'interface' }
}

interface DomainBox {
  domain: WorkspaceDomainProjection
  width: number
  height: number
  minWidth: number
  minHeight: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  contentOffset: NodePosition
  position: NodePosition
}

const DOMAIN_PADDING = 52
const DOMAIN_HEADER = 48
const DOMAIN_GAP = 112
const SHELF_WIDTH = 1900
const CROSS_COLOR = 'oklch(0.76 0.16 35)'
const CONTRACT_COLOR = 'oklch(0.72 0.18 330)'

export const workspaceDomainNodeId = (domainId: string) => `workspace-domain:${domainId}`
export const qualifiedNodeId = (domainId: string, localId: string) =>
  `workspace:${encodeURIComponent(domainId)}:${localId}`

function nodeSize(node: Node): { width: number; height: number } {
  const fallback =
    node.type === 'classNode' || node.type === 'interfaceNode'
      ? { width: 160, height: 88 }
      : node.type === 'moduleNode'
        ? { width: 200, height: 44 }
        : { width: 200, height: 120 }
  return {
    width:
      node.measured?.width ??
      (typeof node.style?.width === 'number' ? node.style.width : fallback.width),
    height:
      node.measured?.height ??
      (typeof node.style?.height === 'number' ? node.style.height : fallback.height),
  }
}

function moduleMinimumSizes(nodes: Node[]): Map<string, WorkspaceSize> {
  const minimums = new Map<string, WorkspaceSize>()
  for (const node of nodes) {
    if (node.type === 'group') minimums.set(node.id, { width: 200, height: 120 })
  }
  for (const child of nodes) {
    if (!child.parentId) continue
    const minimum = minimums.get(child.parentId)
    if (!minimum) continue
    const size = nodeSize(child)
    minimum.width = Math.max(minimum.width, child.position.x + size.width + 14)
    minimum.height = Math.max(minimum.height, child.position.y + size.height + 14)
  }
  for (const minimum of minimums.values()) {
    minimum.width = Math.round(minimum.width)
    minimum.height = Math.round(minimum.height)
  }
  return minimums
}

function domainBounds(
  nodes: Node[],
): Omit<DomainBox, 'domain' | 'position' | 'contentOffset' | 'minWidth' | 'minHeight'> {
  const roots = nodes.filter((node) => !node.parentId)
  if (roots.length === 0) {
    return { width: 360, height: 220, minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const node of roots) {
    const size = nodeSize(node)
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + size.width)
    maxY = Math.max(maxY, node.position.y + size.height)
  }
  return {
    width: Math.max(360, maxX - minX + DOMAIN_PADDING * 2),
    height: Math.max(220, maxY - minY + DOMAIN_PADDING * 2 + DOMAIN_HEADER),
    minX,
    minY,
    maxX,
    maxY,
  }
}

function defaultDomainPositions(boxes: Omit<DomainBox, 'position'>[]): NodePosition[] {
  const positions: NodePosition[] = []
  let x = 0
  let y = 0
  let rowHeight = 0
  for (const box of boxes) {
    if (x > 0 && x + box.width > SHELF_WIDTH) {
      x = 0
      y += rowHeight + DOMAIN_GAP
      rowHeight = 0
    }
    positions.push({ x, y })
    x += box.width + DOMAIN_GAP
    rowHeight = Math.max(rowHeight, box.height)
  }
  return positions
}

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

function externalMemberNodeId(origin: string, name: string): string {
  return `workspace-external-member:${encodeURIComponent(origin)}:${encodeURIComponent(name)}`
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
      nodeId: externalMemberNodeId(imported.origin, type),
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
): { edges: Edge[]; unresolved: Map<string, Map<string, ResolvedTarget['unresolved']>> } {
  const edges: Edge[] = []
  const unresolved = new Map<string, Map<string, ResolvedTarget['unresolved']>>()
  const seen = new Set<string>()

  const remember = (target: ResolvedTarget) => {
    if (!target.unresolved) return
    const byName = unresolved.get(target.unresolved.origin) ?? new Map()
    byName.set(target.unresolved.name, target.unresolved)
    unresolved.set(target.unresolved.origin, byName)
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
          remember(source)
          remember(target)
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

  return { edges, unresolved }
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

function externalNodes(
  unresolved: Map<string, Map<string, ResolvedTarget['unresolved']>>,
  catalog: DomainCatalogEntry[] | undefined,
  x: number,
): Node[] {
  const nodes: Node[] = []
  const byOrigin = new Map((catalog ?? []).map((entry) => [entry.origin, entry]))
  let y = 0
  for (const [origin, members] of [...unresolved.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const entry = byOrigin.get(origin)
    const domainId = `workspace-external:${encodeURIComponent(origin)}`
    const rows = [...members.values()].filter(Boolean)
    const height = 48 + rows.length * 52 + 12
    nodes.push({
      id: domainId,
      type: 'extDomain',
      position: { x, y },
      draggable: false,
      selectable: false,
      data: {
        name: entry?.name ?? origin.split('.')[0],
        origin,
        kind: origin === 'kernel.astrale.ai' ? 'kernel' : 'external',
        icon: entry?.icon,
      },
      style: { width: 216, height },
    })
    rows.forEach((member, index) => {
      if (!member) return
      nodes.push({
        id: externalMemberNodeId(origin, member.name),
        type: 'extMember',
        parentId: domainId,
        extent: 'parent',
        draggable: false,
        position: { x: 12, y: 42 + index * 52 },
        data: {
          name: member.name,
          kind: origin === 'kernel.astrale.ai' ? 'kernel' : 'external',
          definition: member.definition,
        },
        style: { width: 192, height: 44 },
      })
    })
    y += height + 40
  }
  return nodes
}

export function composeWorkspaceCanvas(
  domains: WorkspaceDomainProjection[],
  activeDomainId: string,
  savedDomainPositions: Record<string, NodePosition>,
  catalog?: DomainCatalogEntry[],
  savedContentOffsets: Record<string, NodePosition> = {},
  savedDomainSizes: Record<string, WorkspaceSize> = {},
): WorkspaceProjection {
  const diagnostics = new Set<string>()
  const origins = new Map<string, WorkspaceDomainProjection[]>()
  for (const domain of domains) {
    const origin = domain.input.bundle.ir?.domain ?? domain.input.summary.origin
    const list = origins.get(origin) ?? []
    list.push(domain)
    origins.set(origin, list)
  }

  const rawBoxes = domains.map((domain) => {
    const bounds = domainBounds(domain.nodes)
    const contentOffset = savedContentOffsets[domain.input.summary.id] ?? {
      x: DOMAIN_PADDING - bounds.minX,
      y: DOMAIN_PADDING + DOMAIN_HEADER - bounds.minY,
    }
    const minWidth = Math.max(360, bounds.maxX + contentOffset.x + DOMAIN_PADDING)
    const minHeight = Math.max(220, bounds.maxY + contentOffset.y + DOMAIN_PADDING)
    const savedSize = savedDomainSizes[domain.input.summary.id]
    return {
      domain,
      ...bounds,
      contentOffset,
      width: Math.max(minWidth, savedSize?.width ?? 0),
      height: Math.max(minHeight, savedSize?.height ?? 0),
      minWidth,
      minHeight,
    }
  })
  const defaults = defaultDomainPositions(rawBoxes)
  const boxes: DomainBox[] = rawBoxes.map((box, index) => ({
    ...box,
    position: savedDomainPositions[box.domain.input.summary.id] ?? defaults[index],
  }))
  const nodes: Node[] = []
  const edges: Edge[] = []

  for (const box of boxes) {
    const domainId = box.domain.input.summary.id
    const rootId = workspaceDomainNodeId(domainId)
    const active = domainId === activeDomainId
    nodes.push({
      id: rootId,
      type: 'workspaceDomain',
      position: { x: box.position.x, y: box.position.y },
      draggable: active,
      selectable: true,
      data: {
        domainId,
        origin: box.domain.input.summary.origin,
        memberCount:
          Object.keys(box.domain.input.bundle.ir?.classes ?? {}).length +
          Object.keys(box.domain.input.bundle.ir?.interfaces ?? {}).length,
        active,
        minWidth: box.minWidth,
        minHeight: box.minHeight,
      } satisfies WorkspaceDomainNodeData,
      style: { width: box.width, height: box.height },
    })

    const moduleMinimums = moduleMinimumSizes(box.domain.nodes)
    for (const node of box.domain.nodes) {
      const root = !node.parentId
      const offset = root ? box.contentOffset : { x: 0, y: 0 }
      const minimum = moduleMinimums.get(node.id)
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
            ...(minimum ? { minWidth: minimum.width, minHeight: minimum.height } : {}),
          } satisfies WorkspaceNodeGeometryData,
        },
        extent: 'parent',
        expandParent: true,
        draggable: active,
        selectable: active,
        focusable: active,
        style: {
          ...node.style,
          ...(active ? {} : { pointerEvents: 'none' }),
        },
      })
    }
    for (const edge of box.domain.edges) {
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
  const rightEdge = boxes.reduce((max, box) => Math.max(max, box.position.x + box.width), 0)
  nodes.push(...externalNodes(cross.unresolved, catalog, rightEdge + DOMAIN_GAP))
  edges.push(...cross.edges, ...contracts)

  return {
    nodes,
    edges,
    diagnostics: [...diagnostics].sort(),
    contentOffsets: Object.fromEntries(
      boxes.map((box) => [box.domain.input.summary.id, box.contentOffset]),
    ),
  }
}
