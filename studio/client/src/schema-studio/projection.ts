import type { IrEndpoint, StudioSchemaBundle } from '@shared/types'
import type { Edge, Node } from '@xyflow/react'

import { EDGE_ARROW, edgeMarkers, formatCardinality } from './edge-markers'
import { localEndpointTargets } from './external'
import {
  isKernelClass,
  isKernelImplementationClass,
  type KernelRole,
  kernelRolesOfClass,
} from './inheritance'
import { folderModules, moduleOfClass } from './modules'
import {
  CLASS_H,
  CLASS_W,
  EDGE_WIDTH,
  MODULE_COLLAPSED_H,
  MODULE_HEADER,
  MODULE_PAD,
} from './palette'
import { type Hidden, classNodeVisible, classRef, edgeVisible, isHidden } from './visibility'

export interface ClassNodeData extends Record<string, unknown> {
  domainId: string
  domainOrigin: string
  name: string
  props: number
  methods: number
  /** the kernel bases this Class carries, at any depth — painted as glyphs, and always,
   *  because a role is not a parent list: it holds whether or not the reader asked to see
   *  inheritance, and most of the time nothing on the canvas would otherwise say it. */
  roles: KernelRole[]
  /** the non-Kernel classes this one extends, painted as chips on the card. Kernel ancestry
   *  belongs in the detail panel; Identity, Function, and View remain legible here as roles.
   *  EMPTY while inheritance edges are on, because the chips and edges carry the same fact. */
  parents: string[]
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

/** Project one Domain into ReactFlow structure without positions. */
export function projectDomainCanvas(
  bundle: StudioSchemaBundle,
  collapsed: Set<string>,
  hidden: Hidden,
  showInheritedEdges: boolean,
): DomainProjection {
  const ir = bundle.ir
  if (!ir) return { nodes: [], edges: [] }
  const modules = folderModules(bundle)
    .map((module) => ({
      ...module,
      classes: module.classes.filter(
        (name) => !isKernelImplementationClass({ origin: ir.domain, kind: 'class', name }),
      ),
    }))
    .filter((module) => module.classes.length > 0)
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
      style: {
        width: CLASS_W + MODULE_PAD * 2,
        height: isCollapsed ? MODULE_COLLAPSED_H : MODULE_HEADER + CLASS_H + MODULE_PAD,
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
        // Containment is ours, not React Flow's: `extent:'parent'` pins the class to the RAW
        // box instead of moving the edge it was dragged past, and `expandParent` grows the
        // box flush to the class and never shrinks it back. `normalizeContainerLayout` does
        // the whole job — insets, all four sides, both ways.
        position: { x: 0, y: 0 },
        data: {
          domainId: bundle.domainId,
          domainOrigin: ir.domain,
          name: className,
          props: Object.keys(definition?.properties ?? {}).length,
          methods: Object.keys(definition?.methods ?? {}).length,
          roles: kernelRolesOfClass(bundle, definition?.extendsRefs ?? []),
          parents: showInheritedEdges
            ? []
            : (definition?.extendsRefs ?? [])
                .filter((ref) => !isKernelClass(ref))
                .map((ref) => ref.name),
          hue: module.hue,
          icon: definition?.icon,
        } satisfies ClassNodeData,
      })
    }
  }

  // Every relationship asks for both of its ends' modules, so resolve each Class's once.
  const moduleCache = new Map<string, string>()
  const moduleOf = (className: string): string => {
    let modulePath = moduleCache.get(className)
    if (modulePath === undefined) {
      modulePath = moduleOfClass(bundle, className)
      moduleCache.set(className, modulePath)
    }
    return modulePath
  }
  const representative = (className: string): string => {
    const modulePath = moduleOf(className)
    return collapsed.has(modulePath) ? `grp-${modulePath}` : `class.${className}`
  }
  const edges: Edge[] = []

  for (const edgeClass of Object.values(ir.classes)) {
    if (edgeClass.type !== 'edge') continue
    const [sourceEndpoint, targetEndpoint] = edgeClass.endpoints ?? []
    const left = localEndpointTargets(ir, sourceEndpoint)
    const right = localEndpointTargets(ir, targetEndpoint)
    const markers = edgeMarkers(edgeClass.orientation)
    const ends = {
      sourceEnd: endpointOf(sourceEndpoint),
      targetEnd: endpointOf(targetEndpoint),
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
          )
        ) {
          continue
        }
        const crossModule = moduleOf(sourceTarget.className) !== moduleOf(targetTarget.className)
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
            stroke: crossModule ? 'var(--edge-cross)' : 'var(--edge-line)',
            strokeWidth: EDGE_WIDTH,
          },
        })
      }
    }
  }

  if (showInheritedEdges) {
    for (const [className, definition] of Object.entries(ir.classes)) {
      if (definition.type !== 'node' || isHidden(classRef(className), hidden)) continue
      for (const parent of definition.extendsRefs ?? []) {
        if (isKernelClass(parent)) continue
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
            stroke: 'var(--edge-inherit)',
            strokeWidth: EDGE_WIDTH,
            strokeDasharray: '2 4',
          },
        })
      }
    }
  }

  return { nodes, edges }
}
