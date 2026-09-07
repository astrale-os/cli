import type {
  StudioSchemaBundle,
  ViewInfo,
  ViewTargetCandidate,
  ViewTargetResult,
} from '../../shared/types'

import { queryStudioViewTargets } from '../../../src/lib/view/studio-runtime'
import { decodeJsonObject } from '../cli'
import { reconcileRememberedTarget, targetFromRow, type RawTargetRow } from './model'
import { readRememberedTarget } from './selection-repository'

const TARGET_LIMIT = 200

interface RawQueryResult {
  graph?: { nodes?: RawTargetRow[] }
}

interface ViewTargetDependencies {
  query: typeof queryStudioViewTargets
}

function decodeTargetRow(value: unknown): RawTargetRow | null {
  const row = decodeJsonObject(value)
  if (!row) return null
  const props = decodeJsonObject(row.props)
  return {
    ...(typeof row.id === 'string' ? { id: row.id } : {}),
    ...(props ? { props } : {}),
  }
}

function decodeQueryResult(value: unknown): RawQueryResult | null {
  const payload = decodeJsonObject(value)
  const graph = decodeJsonObject(payload?.graph)
  if (!graph || !Array.isArray(graph.nodes)) return null
  const nodes = graph.nodes.map(decodeTargetRow).filter((row) => row !== null)
  return { graph: { nodes } }
}

export async function listViewTargets(
  root: string,
  origin: string,
  view: ViewInfo,
  bundle: StudioSchemaBundle | null,
  instance: string,
  timeoutMs: number,
  dependencies: Partial<ViewTargetDependencies> = {},
): Promise<ViewTargetResult> {
  const bindings = viewDefinitionBindings(origin, view, bundle)
  if (bindings.length === 0) {
    return {
      status: 'available',
      items: [],
      selected: null,
      stale: null,
      truncated: false,
    }
  }

  const query = dependencies.query ?? queryStudioViewTargets
  const results = await query(
    instance,
    bindings.map((binding) => ({
      definition: targetDefinition(binding.className, binding.classOrigin),
      limit: TARGET_LIMIT + 1,
    })),
    timeoutMs,
  )
  const queried = bindings.map((binding, index) => {
    const result = results[index]
    const data =
      result?.value === null || result?.value === undefined ? null : decodeQueryResult(result.value)
    return {
      binding,
      result: {
        ok: result?.ok === true && data !== null,
        data,
        detail: result?.detail ?? '',
      },
    }
  })
  const successes = queried.filter(
    (item) => item.result.ok && Array.isArray(item.result.data?.graph?.nodes),
  )
  if (successes.length === 0) {
    const reason = queried.map((item) => item.result.detail).find(Boolean)
    return {
      status: 'unavailable',
      items: [],
      selected: null,
      stale: null,
      truncated: false,
      reason: reason || 'The active instance could not be queried for view targets.',
    }
  }

  const byId = new Map<string, ViewTargetCandidate>()
  let truncated = false
  for (const { binding, result } of successes) {
    const rows = result.data?.graph?.nodes ?? []
    if (rows.length > TARGET_LIMIT) truncated = true
    for (const row of rows.slice(0, TARGET_LIMIT)) {
      const target = targetFromRow(row, binding.className, binding.classOrigin)
      if (target) byId.set(target.id, target)
    }
  }
  const items = [...byId.values()].sort(
    (a, b) => a.label.localeCompare(b.label) || a.className.localeCompare(b.className),
  )
  const remembered = readRememberedTarget(root, instance, view.slug)
  return {
    status: 'available',
    items,
    ...reconcileRememberedTarget(remembered, items),
    truncated,
  }
}

export function targetDefinition(className: string, classOrigin: string): string {
  return `/:${assertOrigin(classOrigin)}:class.${assertSchemaName(className)}`
}

export interface ViewDefinitionBinding {
  className: string
  classOrigin: string
  kind: 'class'
}

/** Preserve exact canonical View target coordinates. */
export function viewDefinitionBindings(
  origin: string,
  view: ViewInfo,
  bundle: StudioSchemaBundle | null,
): ViewDefinitionBinding[] {
  const target = bundle?.ir?.views?.[view.slug]?.target
  if (target) {
    if (target.kind === 'domain') return []
    return uniqueViewBindings(
      target.definitions.flatMap((definition) =>
        definition.kind === 'class'
          ? [
              {
                className: definition.name,
                classOrigin: definition.origin,
                kind: 'class' as const,
              },
            ]
          : [],
      ),
    )
  }

  const names = Array.isArray(view.viewFor) ? view.viewFor : view.viewFor ? [view.viewFor] : []
  const ir = bundle?.ir
  if (!ir) {
    return uniqueViewBindings(
      names.map((className) => ({ className, classOrigin: origin, kind: 'class' })),
    )
  }

  return uniqueViewBindings(
    names.flatMap((className) => {
      const local: ViewDefinitionBinding[] = []
      const localClass = ir.classes[className]
      if (localClass) {
        local.push({
          className,
          classOrigin: localClass.ref?.origin ?? localClass.origin ?? ir.domain ?? origin,
          kind: 'class',
        })
      }
      const imported = Object.keys(ir.importsByKey).flatMap((key) => {
        const binding = viewBindingFromDefinitionKey(key)
        return binding?.className === className ? [binding] : []
      })
      if (imported.length > 0) return [...local, ...imported]

      return local.length > 0 ? local : [{ className, classOrigin: origin, kind: 'class' }]
    }),
  )
}

function viewBindingFromDefinitionKey(key: string): ViewDefinitionBinding | null {
  const separator = key.lastIndexOf(':')
  if (separator <= 0) return null
  const classOrigin = key.slice(0, separator)
  const ref = key.slice(separator + 1)
  const match = /^class\.([A-Za-z_$][\w$]*)$/.exec(ref)
  if (!match) return null
  return {
    className: match[1]!,
    classOrigin,
    kind: 'class',
  }
}

function uniqueViewBindings(bindings: ViewDefinitionBinding[]): ViewDefinitionBinding[] {
  const unique = new Map<string, ViewDefinitionBinding>()
  for (const binding of bindings) {
    const key = `${binding.classOrigin}:${binding.kind}.${binding.className}`
    if (!unique.has(key)) unique.set(key, binding)
  }
  return [...unique.values()]
}

function assertOrigin(value: string): string {
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(value)) throw new Error(`Invalid domain origin: ${value}`)
  return value
}

function assertSchemaName(value: string): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(value)) throw new Error(`Invalid class name: ${value}`)
  return value
}
