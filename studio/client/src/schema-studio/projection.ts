import type { IrInterface, StudioSchemaBundle } from '@shared/types'

import { MarkerType, type Edge, type Node } from '@xyflow/react'

import { cardinalityMarkers } from './cardinality-markers'
import { localEndpointTargets } from './external'
import { folderModules, moduleOfClass, moduleOfInterface } from './modules'
import {
  type Hidden,
  type Materialized,
  classNodeVisible,
  classRef,
  edgeVisible,
  isHidden,
  isMaterialized,
  visibleInterfaceBadges,
} from './visibility'

export type SchemaCoreRole = 'container' | 'identity' | 'function'

export interface ClassNodeData extends Record<string, unknown> {
  domainId: string
  name: string
  props: number
  methods: number
  interfaces: string[]
  coreRole?: SchemaCoreRole | null
  hue: number
  icon?: string
}

export interface InterfaceNodeData extends Record<string, unknown> {
  domainId: string
  name: string
  props: number
  methods: number
}

export interface GroupNodeData extends Record<string, unknown> {
  domainId: string
  label: string
  path: string
  hue: number
  interfaces: string[]
  collapsed: boolean
  classCount: number
  onToggleModule?: (domainId: string, path: string) => void
}

export interface DomainProjection {
  nodes: Node[]
  edges: Edge[]
}

function schemaRefName(ref: unknown): string {
  return (
    String(ref ?? '')
      .split(/[.:/]/)
      .pop() ?? ''
  )
}

function schemaRefList(refs: unknown): string[] {
  return Array.isArray(refs) ? refs.map(String) : refs ? [String(refs)] : []
}

function schemaInterfaceMap(bundle: StudioSchemaBundle): Record<string, IrInterface> {
  const out: Record<string, IrInterface> = {}
  for (const source of [bundle.importedInterfaces, bundle.ir?.interfaces]) {
    for (const [name, definition] of Object.entries(source ?? {})) {
      out[schemaRefName(name)] = definition
    }
  }
  return out
}

function schemaCoreRole(refs: unknown, bundle: StudioSchemaBundle): SchemaCoreRole | null {
  const interfaces = schemaInterfaceMap(bundle)
  const seen = new Set<string>()
  const stack = schemaRefList(refs).map(schemaRefName)
  while (stack.length) {
    const name = stack.pop()
    if (!name || seen.has(name)) continue
    seen.add(name)
    const definition = interfaces[name] as
      | (IrInterface & { implements?: string[]; interfaces?: string[] })
      | undefined
    for (const parent of [
      ...schemaRefList(definition?.extends),
      ...schemaRefList(definition?.implements),
      ...schemaRefList(definition?.interfaces),
    ]) {
      stack.push(schemaRefName(parent))
    }
  }
  if (seen.has('Function')) return 'function'
  if (seen.has('Identity')) return 'identity'
  if (seen.has('Container')) return 'container'
  return null
}

export function localInterfaceRendered(
  bundle: StudioSchemaBundle,
  collapsed: Set<string>,
  materialized: Materialized,
  name: string,
): boolean {
  return (
    isMaterialized(name, materialized) &&
    !!bundle.ir?.interfaces[name] &&
    !collapsed.has(moduleOfInterface(bundle, name))
  )
}

const INTERFACE_COLOR = 'oklch(0.72 0.18 330)'

/**
 * Project one domain into ReactFlow structure without positions. This is the single
 * schema-to-canvas boundary used by both the focused and federated canvases.
 */
export function projectDomainCanvas(
  bundle: StudioSchemaBundle,
  collapsed: Set<string>,
  hidden: Hidden,
  showInheritedEdges: boolean,
  materialized: Materialized,
): DomainProjection {
  const ir = bundle.ir
  if (!ir) return { nodes: [], edges: [] }

  const interfaceRendered = (name: string): boolean =>
    localInterfaceRendered(bundle, collapsed, materialized, name)
  const renderedInterfaces = new Set(Object.keys(ir.interfaces).filter(interfaceRendered))
  const modules = folderModules(bundle).filter(
    (module) =>
      module.classes.length > 0 || module.interfaces.some((name) => renderedInterfaces.has(name)),
  )
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
        label: module.label,
        path: module.path,
        hue: module.hue,
        interfaces: module.interfaces.filter((name) => !renderedInterfaces.has(name)),
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
          name: className,
          props: Object.keys(definition?.properties ?? {}).length,
          methods: Object.keys(definition?.methods ?? {}).length,
          interfaces: visibleInterfaceBadges(bundle, className, renderedInterfaces),
          coreRole: schemaCoreRole(definition?.implements ?? [], bundle),
          hue: module.hue,
          icon: definition?.icon,
        } satisfies ClassNodeData,
      })
    }

    for (const interfaceName of module.interfaces) {
      if (!renderedInterfaces.has(interfaceName)) continue
      const definition = ir.interfaces[interfaceName]!
      nodes.push({
        id: `iface.${interfaceName}`,
        type: 'interfaceNode',
        parentId: groupId,
        extent: 'parent',
        expandParent: true,
        position: { x: 0, y: 0 },
        data: {
          domainId: bundle.domainId,
          name: interfaceName,
          props: Object.keys(definition.properties ?? {}).length,
          methods: Object.keys(definition.methods ?? {}).length,
        } satisfies InterfaceNodeData,
      })
    }
  }

  const representative = (className: string) => {
    const modulePath = moduleOfClass(bundle, className)
    return collapsed.has(modulePath) ? `grp-${modulePath}` : `class.${className}`
  }
  const targetsOf = (endpoint?: { types?: string[] }) =>
    localEndpointTargets(ir, endpoint, interfaceRendered)
  const targetModule = (target: { cls: string | null; ifaceNode: string | null }): string =>
    target.cls !== null
      ? moduleOfClass(bundle, target.cls)
      : moduleOfInterface(bundle, target.ifaceNode!.slice('iface.'.length))

  const edges: Edge[] = []
  for (const edgeClass of Object.values(ir.classes)) {
    if (edgeClass.type !== 'edge') continue
    const aTargets = targetsOf(edgeClass.endpoints?.[0])
    const bTargets = targetsOf(edgeClass.endpoints?.[1])
    const cardinality = cardinalityMarkers(
      edgeClass.endpoints?.[0]?.cardinality,
      edgeClass.endpoints?.[1]?.cardinality,
    )

    for (const a of aTargets) {
      for (const b of bTargets) {
        const viaInterfaces = [a.viaInterface, b.viaInterface].filter(
          (name): name is string => name !== null,
        )
        const source = a.ifaceNode ?? representative(a.cls!)
        const target = b.ifaceNode ?? representative(b.cls!)
        if (
          !edgeVisible(
            {
              edgeName: edgeClass.name,
              aClass: a.cls ?? '',
              bClass: b.cls ?? '',
              viaInterfaces,
            },
            hidden,
            showInheritedEdges,
          ) ||
          source === target
        ) {
          continue
        }

        const crossModule = targetModule(a) !== targetModule(b)
        const polymorphic = viaInterfaces.length > 0
        const color = crossModule ? 'oklch(0.72 0.16 35)' : 'oklch(0.62 0.07 264)'
        edges.push({
          id: `edge-${edgeClass.name}__${source}__${target}`,
          source,
          target,
          type: 'floating',
          data: {
            label: edgeClass.name,
            edgeClass: edgeClass.name,
            ownerDomainId: bundle.domainId,
            polymorphic,
          },
          markerStart: cardinality.markerStart,
          markerEnd: cardinality.markerEnd,
          style: {
            stroke: color,
            strokeWidth: crossModule ? 2.4 : 1.8,
            ...(polymorphic ? { strokeDasharray: '7 4' } : {}),
          },
        })
      }
    }
  }

  for (const [className, definition] of Object.entries(ir.classes)) {
    if (definition.type !== 'node' || isHidden(classRef(className), hidden)) continue
    for (const interfaceName of definition.implements ?? []) {
      if (!interfaceRendered(interfaceName)) continue
      const source = representative(className)
      const target = `iface.${interfaceName}`
      if (source === target) continue
      edges.push({
        id: `implements-${className}__${interfaceName}`,
        source,
        target,
        type: 'floating',
        data: { kind: 'implements', ownerDomainId: bundle.domainId },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: INTERFACE_COLOR,
          width: 16,
          height: 16,
        },
        style: { stroke: INTERFACE_COLOR, strokeWidth: 1.6, strokeDasharray: '7 4' },
      })
    }
  }

  for (const [interfaceName, definition] of Object.entries(ir.interfaces)) {
    if (!interfaceRendered(interfaceName)) continue
    for (const parent of definition.extends ?? []) {
      if (!interfaceRendered(parent)) continue
      edges.push({
        id: `extends-${interfaceName}__${parent}`,
        source: `iface.${interfaceName}`,
        target: `iface.${parent}`,
        type: 'floating',
        data: { label: 'extends', kind: 'extends', ownerDomainId: bundle.domainId },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: INTERFACE_COLOR,
          width: 16,
          height: 16,
        },
        style: { stroke: INTERFACE_COLOR, strokeWidth: 1.6, strokeDasharray: '2 4' },
      })
    }
  }

  return { nodes, edges }
}
