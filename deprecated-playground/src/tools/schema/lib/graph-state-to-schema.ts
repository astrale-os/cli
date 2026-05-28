/**
 * Graph-State → Schema
 *
 * Derives the schema (Class/Interface/Syscall topology) directly from
 * the live graph state. Produces the "distribution" format consumed by
 * schemaToFlow — no static JSON file needed.
 *
 * Strategy:
 *  1. Index Class / Interface / Syscall nodes by label.
 *  2. Resolve implements, extends, method_of edges.
 *  3. For edge-classes, infer endpoint types from actual reified
 *     instances (from/to structural edges → instance_of → class).
 *  4. Assemble { nodes, edges, methods }.
 */

import type { GraphStateData } from '@/lib/types'

import {
  STRUCTURE_TYPE,
  STRUCTURE_LABEL,
  DOMAIN_TYPE,
  DOMAIN_LABEL,
} from '@/tools/graph-state/lib/kernel-fabric'

interface SchemaOutput {
  nodes: Record<string, { abstract?: boolean; implements?: string[]; attributes: string[] }>
  edges: Record<string, { endpoints: Record<string, { types: string[] }> }>
  methods: Record<string, Record<string, { returns: string }>>
}

const NAME_KEYS = ['slug', 'key', 'name'] as const

function resolveName(node: Record<string, unknown>): string | null {
  for (const k of NAME_KEYS) {
    const v = node[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

export function graphStateToSchema(raw: GraphStateData): SchemaOutput | null {
  if (!raw.nodes.length) return null

  const classNodes = new Map<string, { name: string; kind: 'node' | 'edge'; id: string }>()
  const interfaceNodes = new Map<string, { name: string; id: string }>()
  const syscallNodes = new Map<string, { name: string; id: string; resultSchema?: string }>()

  for (const n of raw.nodes) {
    const labels = n.labels ?? []
    const name = resolveName(n as Record<string, unknown>)
    if (!name) continue
    if (labels.includes(STRUCTURE_LABEL.Class)) {
      const kind =
        (n as Record<string, unknown>).type === 'edge' ? ('edge' as const) : ('node' as const)
      classNodes.set(n.id, { name, kind, id: n.id })
    } else if (labels.includes(DOMAIN_LABEL.Interface)) {
      interfaceNodes.set(n.id, { name, id: n.id })
    } else if (labels.includes(DOMAIN_LABEL.Function)) {
      const props = n as Record<string, unknown>
      syscallNodes.set(n.id, {
        name,
        id: n.id,
        resultSchema: typeof props.resultSchema === 'string' ? props.resultSchema : undefined,
      })
    }
  }

  if (classNodes.size === 0 && interfaceNodes.size === 0) return null

  const implementsEdges: { src: string; dest: string }[] = []
  const extendsEdges: { src: string; dest: string }[] = []
  const methodOfEdges: { src: string; dest: string }[] = []
  const instanceOfIndex = new Map<string, string>()
  const fromIndex = new Map<string, string>()
  const toIndex = new Map<string, string>()

  for (const e of raw.edges) {
    switch (e.type) {
      case DOMAIN_TYPE.implements:
        implementsEdges.push(e)
        break
      case DOMAIN_TYPE.extends:
        extendsEdges.push(e)
        break
      case DOMAIN_TYPE.methodOf:
        methodOfEdges.push(e)
        break
      case STRUCTURE_TYPE.instanceOf:
        instanceOfIndex.set(e.src, e.dest)
        break
      case STRUCTURE_TYPE.from:
        fromIndex.set(e.dest, e.src)
        break
      case STRUCTURE_TYPE.to:
        toIndex.set(e.src, e.dest)
        break
    }
  }

  const allMetaIds = new Set([
    ...classNodes.keys(),
    ...interfaceNodes.keys(),
    ...syscallNodes.keys(),
  ])

  const implMap = new Map<string, string[]>()
  for (const e of implementsEdges) {
    const parent = interfaceNodes.get(e.dest)
    if (!parent) continue
    const list = implMap.get(e.src) ?? []
    list.push(parent.name)
    implMap.set(e.src, list)
  }

  const extMap = new Map<string, string[]>()
  for (const e of extendsEdges) {
    const parent = interfaceNodes.get(e.dest)
    if (!parent) continue
    const list = extMap.get(e.src) ?? []
    list.push(parent.name)
    extMap.set(e.src, list)
  }

  const methodMap = new Map<string, { opName: string; returns: string }[]>()
  for (const e of methodOfEdges) {
    const op = syscallNodes.get(e.src)
    if (!op) continue
    const ownerName = classNodes.get(e.dest)?.name ?? interfaceNodes.get(e.dest)?.name
    if (!ownerName) continue
    const list = methodMap.get(ownerName) ?? []
    let returns = 'void'
    if (op.resultSchema) {
      try {
        returns = JSON.parse(op.resultSchema)?.type ?? 'void'
      } catch {
        /* keep void */
      }
    }
    list.push({ opName: op.name, returns })
    methodMap.set(ownerName, list)
  }

  const edgeEndpoints = new Map<string, { sources: Set<string>; targets: Set<string> }>()
  for (const [edgeNodeId, sourceId] of fromIndex) {
    const targetId = toIndex.get(edgeNodeId)
    if (!targetId) continue
    if (allMetaIds.has(edgeNodeId)) continue
    const classId = instanceOfIndex.get(edgeNodeId)
    if (!classId) continue
    const cls = classNodes.get(classId)
    if (!cls || cls.kind !== 'edge') continue
    let ep = edgeEndpoints.get(cls.name)
    if (!ep) {
      ep = { sources: new Set(), targets: new Set() }
      edgeEndpoints.set(cls.name, ep)
    }
    const srcClassId = instanceOfIndex.get(sourceId)
    const tgtClassId = instanceOfIndex.get(targetId)
    const srcName = srcClassId
      ? (classNodes.get(srcClassId)?.name ?? interfaceNodes.get(srcClassId)?.name)
      : null
    const tgtName = tgtClassId
      ? (classNodes.get(tgtClassId)?.name ?? interfaceNodes.get(tgtClassId)?.name)
      : null
    if (srcName) ep.sources.add(srcName)
    if (tgtName) ep.targets.add(tgtName)
  }

  const nodes: SchemaOutput['nodes'] = {}
  const edges: SchemaOutput['edges'] = {}
  const methods: SchemaOutput['methods'] = {}

  for (const [id, info] of interfaceNodes) {
    nodes[info.name] = { abstract: true, implements: extMap.get(id) ?? [], attributes: [] }
  }

  for (const [id, info] of classNodes) {
    if (info.kind === 'node') {
      nodes[info.name] = { abstract: false, implements: implMap.get(id) ?? [], attributes: [] }
    } else {
      const ep = edgeEndpoints.get(info.name)
      const sourceTypes = ep ? [...ep.sources] : ['*']
      const targetTypes = ep ? [...ep.targets] : ['*']
      edges[info.name] = {
        endpoints: {
          source: { types: sourceTypes.length > 0 ? sourceTypes : ['*'] },
          target: { types: targetTypes.length > 0 ? targetTypes : ['*'] },
        },
      }
    }
  }

  for (const [ownerName, ops] of methodMap) {
    methods[ownerName] = {}
    for (const op of ops) {
      methods[ownerName][op.opName] = { returns: op.returns }
    }
  }

  return { nodes, edges, methods }
}
