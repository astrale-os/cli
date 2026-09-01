import type { DomainCatalogEntry, IrClassRef, IrEndpoint } from '@shared/types'
import type { Edge, Node } from '@xyflow/react'

import { isIrClassRef } from '@shared/schema/identity'

import { encodeFlowEdgeId, encodeFlowNodeId } from '@/lib/targets'
import { buildViewsModel } from '@/lib/views'

import type { WorkspaceDomainInput } from './use-domain-inputs'

import { EDGE_ARROW, edgeMarkers, formatCardinality } from '../edge-markers'
import { elkLayout } from '../elk-layout'
import { applyGeometry, geometryOf, packPendingNodes, type Geometry } from '../geometry'
import { moduleOfClass } from '../modules'
import { projectDomainCanvas } from '../projection'
import { viewGraph } from '../view-graph'
import { classRef, domainRef, edgeRef, isHidden } from '../visibility'
import {
  projectExternalFrames,
  workspaceExternalMemberNodeId,
  type WorkspaceExternalCluster,
  type WorkspaceExternalReference,
} from './external-frames'
import {
  DOMAIN_CONTENT_ORIGIN,
  layoutWorkspaceFrames,
  type WorkspaceNodeGeometryData,
  type WorkspacePoint,
} from './geometry'

export interface WorkspaceDomainProjection {
  input: WorkspaceDomainInput
  collapsed: Set<string>
  nodes: Node[]
  edges: Edge[]
  /** Put away by the rail's eye: still composed, but nothing of it is drawn. */
  hidden?: boolean
}

export interface WorkspaceDomainNodeData extends Record<string, unknown> {
  domainId: string
  origin: string
}

export interface WorkspaceProjection {
  nodes: Node[]
  edges: Edge[]
  diagnostics: string[]
  domainPositions: Record<string, WorkspacePoint>
  externalPositions: Record<string, WorkspacePoint>
}

export interface ComposeWorkspaceCanvasOptions {
  domainPositions?: Record<string, WorkspacePoint>
  externalPositions?: Record<string, WorkspacePoint>
  catalog?: DomainCatalogEntry[]
}

interface ResolvedTarget {
  nodeId: string
  domainId: string | null
  className: string | null
  unresolved?: WorkspaceExternalReference
}

const CROSS_COLOR = 'var(--edge-cross)'
const INHERITANCE_COLOR = 'var(--edge-inherit)'

export const workspaceDomainNodeId = (domainId: string) => `workspace-domain:${domainId}`
export const qualifiedNodeId = encodeFlowNodeId

/** Layout one Domain independently, reusing persisted geometry and packing only new nodes. */
export async function prepareWorkspaceDomain(
  input: WorkspaceDomainInput,
  collapsedModules: string[],
): Promise<WorkspaceDomainProjection> {
  const collapsed = new Set(collapsedModules)
  const schema = projectDomainCanvas(
    input.bundle,
    collapsed,
    input.visibility.hidden,
    input.visibility.showInheritedEdges,
  )
  // Views ride in the domain's own projection, so the frame layout, the drag
  // persistence and the id prefixing below treat them exactly like a class.
  const views = viewGraph(
    buildViewsModel(input.anatomy, input.bundle),
    input.bundle,
    collapsed,
    input.visibility.hidden,
  )
  const structure = {
    nodes: [...schema.nodes, ...views.nodes],
    edges: [...schema.edges, ...views.edges],
  }
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
  if (domain.hidden || !ir || ir.classes[name]?.type !== 'node') return undefined
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

  // An imported domain the reader hid stays hidden — the Domains panel's eye writes
  // `domain.<origin>` into the owner's visibility, and this is where it lands.
  if (isHidden(domainRef(ref.origin), owner.input.visibility.hidden)) return []

  const candidates = origins.get(ref.origin) ?? []
  if (candidates.length > 1) {
    diagnostics.add(`Multiple selected folders declare ${ref.origin}; ${ref.name} stays external.`)
  }
  if (candidates.length === 1) {
    const target = localTarget(candidates[0], ref.name)
    if (target) return [target]
    // A domain the reader put away is not missing — it is out of view, and what pointed
    // at it goes with it. Drawing it back as an "unresolved" external box would answer
    // the eye by replacing the domain with a stub of itself.
    if (candidates[0].hidden) return []
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
  return encodeFlowEdgeId(ownerId, name, source, target)
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
    if (!ir || owner.hidden) continue
    for (const edgeClass of Object.values(ir.classes)) {
      if (edgeClass.type !== 'edge' || edgeClass.endpoints?.length !== 2) continue
      if (isHidden(edgeRef(edgeClass.name), owner.input.visibility.hidden)) continue
      const sources = endpointClasses(edgeClass.endpoints[0]).flatMap((input) =>
        resolveClass(owner, input, origins, diagnostics),
      )
      const targets = endpointClasses(edgeClass.endpoints[1]).flatMap((input) =>
        resolveClass(owner, input, origins, diagnostics),
      )
      const markers = edgeMarkers(edgeClass.orientation)
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
              sourceEnd: {
                ...(edgeClass.endpoints?.[0]?.name ? { role: edgeClass.endpoints[0].name } : {}),
                cardinality: formatCardinality(edgeClass.endpoints?.[0]?.cardinality),
              },
              targetEnd: {
                ...(edgeClass.endpoints?.[1]?.name ? { role: edgeClass.endpoints[1].name } : {}),
                cardinality: formatCardinality(edgeClass.endpoints?.[1]?.cardinality),
              },
            },
            markerStart: markers.markerStart,
            markerEnd: markers.markerEnd,
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
    if (!ir || owner.hidden || !owner.input.visibility.showInheritedEdges) continue
    for (const [className, definition] of Object.entries(ir.classes)) {
      if (definition.type !== 'node') continue
      const source = localTarget(owner, className)
      if (!source) continue
      for (const parent of definition.extendsRefs ?? []) {
        for (const target of resolveClass(owner, parent, origins, diagnostics)) {
          if (target.unresolved || target.nodeId === source.nodeId) continue
          // A parent in the owner's OWN domain is already drawn by that domain's projection.
          // Same guard the relationship edges use above — without it every local `extends`
          // lands on the canvas twice, perfectly superposed and routed twice over.
          if (target.domainId === owner.input.summary.id) continue
          const id = `workspace-extends:${source.nodeId}:${target.nodeId}`
          if (seen.has(id)) continue
          seen.add(id)
          edges.push({
            id,
            source: source.nodeId,
            target: target.nodeId,
            type: 'floating',
            data: { label: 'extends', kind: 'extends', ownerDomainId: owner.input.summary.id },
            markerEnd: EDGE_ARROW,
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
  { domainPositions = {}, externalPositions = {}, catalog }: ComposeWorkspaceCanvasOptions = {},
): WorkspaceProjection {
  const diagnostics = new Set<string>()
  const origins = new Map<string, WorkspaceDomainProjection[]>()
  for (const domain of domains) {
    const origin = domain.input.bundle.ir?.domain ?? domain.input.summary.origin
    origins.set(origin, [...(origins.get(origin) ?? []), domain])
  }

  // A hidden domain stays in `origins` — the resolver has to recognise it to answer
  // "put away" rather than "never heard of it" — but nothing below draws it.
  const drawn = domains.filter((domain) => !domain.hidden)
  const frames = layoutWorkspaceFrames(
    drawn.map((domain) => ({ domainId: domain.input.summary.id, nodes: domain.nodes })),
    domainPositions,
  )
  const framesByDomain = new Map(frames.map((frame) => [frame.domainId, frame]))
  const nodes: Node[] = []
  const edges: Edge[] = []

  for (const domain of drawn) {
    const domainId = domain.input.summary.id
    const frame = framesByDomain.get(domainId)!
    const rootId = workspaceDomainNodeId(domainId)
    nodes.push({
      id: rootId,
      type: 'workspaceDomain',
      position: frame.position,
      // A frame moves exactly like a module box: grab it anywhere, drag it. It is never
      // SELECTED though — a domain is a place, not a thing you open, and which one is
      // active is answered by the domains rail, not by repainting the canvas.
      draggable: true,
      selectable: false,
      data: {
        domainId,
        origin: domain.input.summary.origin,
      } satisfies WorkspaceDomainNodeData,
      style: { width: frame.size.width, height: frame.size.height },
    })

    for (const node of domain.nodes) {
      const root = !node.parentId
      const offset = root ? DOMAIN_CONTENT_ORIGIN : { x: 0, y: 0 }
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
          } satisfies WorkspaceNodeGeometryData,
        },
        // Containment is OURS, not React Flow's: `extent:'parent'` pins a node to the box
        // it happens to be in, which is exactly what must NOT happen — dragging past an
        // edge moves that edge. `normalizeContainerLayout` re-fits the box instead.
        expandParent: false,
        // Every domain on the canvas is furniture you can move. A drag edits the layout
        // of the domain the node belongs to — `onNodeDragStop` reads that owner off the
        // node — so there is nothing for the ACTIVE domain to privilege here.
        draggable: true,
        selectable: true,
        focusable: true,
        style: node.style,
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
  }
}
