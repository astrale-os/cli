import type { IrClassRef, IrEndpoint, StudioSchemaBundle } from '@shared/types'
import type { Edge, Node } from '@xyflow/react'

import { EDGE_ARROW, edgeMarkers, formatCardinality } from './edge-markers'
import { localEndpointTargets } from './external'
import { folderModules, moduleOfClass } from './modules'
import { CLASS_H, CLASS_W, MODULE_COLLAPSED_H, MODULE_HEADER, MODULE_PAD } from './palette'
import { type Hidden, classNodeVisible, classRef, edgeVisible, isHidden } from './visibility'

export type SchemaCoreRole = 'container' | 'identity'

export interface ClassNodeData extends Record<string, unknown> {
  domainId: string
  domainOrigin: string
  name: string
  props: number
  methods: number
  coreRole?: SchemaCoreRole | null
  hue: number
  icon?: string
}

export interface GroupNodeData extends Record<string, unknown> {
  domainId: string
  domainOrigin: string
  label: string
  path: string
  hue: number
  collapsed: boolean
  classCount: number
  onToggleModule?: (domainId: string, path: string) => void
}

/** What the cardinality mode shows at one end of a relationship. */
function endpointOf(endpoint?: IrEndpoint): { role?: string; cardinality: string } {
  return {
    ...(endpoint?.name ? { role: endpoint.name } : {}),
    cardinality: formatCardinality(endpoint?.cardinality),
  }
}

export interface DomainProjection {
  nodes: Node[]
  edges: Edge[]
}

function coreRole(refs: readonly IrClassRef[]): SchemaCoreRole | null {
  const kernel = refs.filter((ref) => ref.origin === 'kernel.astrale.ai')
  if (kernel.some((ref) => ref.name === 'Identity')) return 'identity'
  if (kernel.some((ref) => ref.name === 'Container')) return 'container'
  return null
}

/** Project one Domain into ReactFlow structure without positions. */
export function projectDomainCanvas(
  bundle: StudioSchemaBundle,
  collapsed: Set<string>,
  hidden: Hidden,
  showInheritedEdges: boolean,
): DomainProjection {
  const ir = bundle.ir
  if (!ir) return { nodes: [], edges: [] }
  const modules = folderModules(bundle).filter((module) => module.classes.length > 0)
  const nodes: Node[] = []

  for (const module of modules) {
    const groupId = `grp-${module.path}`
    const isCollapsed = collapsed.has(module.path)
    nodes.push({
      id: groupId,
      type: isCollapsed ? 'moduleNode' : 'group',
      position: { x: 0, y: 0 },
      selectable: true,
      data: {
        domainId: bundle.domainId,
        domainOrigin: ir.domain,
        label: module.label,
        path: module.path,
        hue: module.hue,
        collapsed: isCollapsed,
        classCount: module.classes.length,
      } satisfies GroupNodeData,
      style: isCollapsed
        ? { width: CLASS_W + MODULE_PAD * 2, height: MODULE_COLLAPSED_H }
        : {
            width: CLASS_W + MODULE_PAD * 2,
            height: MODULE_HEADER + CLASS_H + MODULE_PAD,
          },
    })
    if (isCollapsed) continue

    for (const className of module.classes) {
      if (!classNodeVisible(className, hidden)) continue
      const definition = ir.classes[className]
      nodes.push({
        id: `class.${className}`,
        type: 'classNode',
        parentId: groupId,
        extent: 'parent',
        expandParent: true,
        position: { x: 0, y: 0 },
        data: {
          domainId: bundle.domainId,
          domainOrigin: ir.domain,
          name: className,
          props: Object.keys(definition?.properties ?? {}).length,
          methods: Object.keys(definition?.methods ?? {}).length,
          coreRole: coreRole(definition?.extendsRefs ?? []),
          hue: module.hue,
          icon: definition?.icon,
        } satisfies ClassNodeData,
      })
    }
  }

  const representative = (className: string): string => {
    const modulePath = moduleOfClass(bundle, className)
    return collapsed.has(modulePath) ? `grp-${modulePath}` : `class.${className}`
  }
  const targets = (endpoint?: IrEndpoint) => localEndpointTargets(ir, endpoint)
  const edges: Edge[] = []

  for (const edgeClass of Object.values(ir.classes)) {
    if (edgeClass.type !== 'edge') continue
    const left = targets(edgeClass.endpoints?.[0])
    const right = targets(edgeClass.endpoints?.[1])
    const markers = edgeMarkers(edgeClass.orientation)
    const ends = {
      sourceEnd: endpointOf(edgeClass.endpoints?.[0]),
      targetEnd: endpointOf(edgeClass.endpoints?.[1]),
    }
    for (const sourceTarget of left) {
      for (const targetTarget of right) {
        const source = representative(sourceTarget.className)
        const target = representative(targetTarget.className)
        if (
          source === target ||
          !edgeVisible(
            {
              edgeName: edgeClass.name,
              aClass: sourceTarget.className,
              bClass: targetTarget.className,
            },
            hidden,
            showInheritedEdges,
          )
        ) {
          continue
        }
        const crossModule =
          moduleOfClass(bundle, sourceTarget.className) !==
          moduleOfClass(bundle, targetTarget.className)
        edges.push({
          id: `edge-${edgeClass.name}__${source}__${target}`,
          source,
          target,
          type: 'floating',
          data: {
            label: edgeClass.name,
            edgeClass: edgeClass.name,
            ownerDomainId: bundle.domainId,
            ...ends,
          },
          markerStart: markers.markerStart,
          markerEnd: markers.markerEnd,
          style: {
            stroke: crossModule ? 'oklch(0.68 0.1 45)' : 'oklch(0.74 0.02 255)',
            strokeWidth: crossModule ? 1.6 : 1.3,
          },
        })
      }
    }
  }

  if (showInheritedEdges) {
    for (const [className, definition] of Object.entries(ir.classes)) {
      if (definition.type !== 'node' || isHidden(classRef(className), hidden)) continue
      for (const parent of definition.extendsRefs ?? []) {
        if (parent.origin !== ir.domain || ir.classes[parent.name]?.type !== 'node') continue
        const source = representative(className)
        const target = representative(parent.name)
        if (source === target) continue
        edges.push({
          id: `extends-${className}__${parent.name}`,
          source,
          target,
          type: 'floating',
          data: { label: 'extends', kind: 'extends', ownerDomainId: bundle.domainId },
          markerEnd: EDGE_ARROW,
          style: {
            stroke: 'oklch(0.55 0.14 300)',
            strokeWidth: 1.3,
            strokeDasharray: '2 4',
          },
        })
      }
    }
  }

  return { nodes, edges }
}
