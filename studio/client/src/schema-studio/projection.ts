import type { IrClassRef, IrEndpoint, StudioSchemaBundle } from '@shared/types'

import { MarkerType, type Edge, type Node } from '@xyflow/react'

import { cardinalityMarkers } from './cardinality-markers'
import { localEndpointTargets } from './external'
import { folderModules, moduleOfClass } from './modules'
import { type Hidden, classNodeVisible, classRef, edgeVisible, isHidden } from './visibility'

export type SchemaCoreRole = 'container' | 'identity'

export interface ClassNodeData extends Record<string, unknown> {
  domainId: string
  domainOrigin: string
  name: string
  props: number
  methods: number
  bases: string[]
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
      style: isCollapsed ? { width: 200, height: 44 } : { width: 200, height: 120 },
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
          bases: (definition?.extendsRefs ?? []).map((ref) => ref.name),
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
    const markers = cardinalityMarkers(
      edgeClass.endpoints?.[0]?.cardinality,
      edgeClass.endpoints?.[1]?.cardinality,
    )
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
          },
          markerStart: markers.markerStart,
          markerEnd: markers.markerEnd,
          style: {
            stroke: crossModule ? 'oklch(0.72 0.16 35)' : 'oklch(0.62 0.07 264)',
            strokeWidth: crossModule ? 2.4 : 1.8,
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
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: 'oklch(0.72 0.18 330)',
            width: 16,
            height: 16,
          },
          style: {
            stroke: 'oklch(0.72 0.18 330)',
            strokeWidth: 1.6,
            strokeDasharray: '2 4',
          },
        })
      }
    }
  }

  return { nodes, edges }
}
