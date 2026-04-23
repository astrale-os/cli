import { useEffect, useMemo, useState } from 'react'

import type { BusinessGraph } from '@/tools/graph-state/lib/raw-to-business'
import type { OpEntry, ParamField } from '@/tools/operations/lib/op-registry'

import { useConnection } from '@/hooks/use-connection'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'
import { rawToBusiness } from '@/tools/graph-state/lib/raw-to-business'
import { OpForm, type OpCallResult } from '@/tools/operations/components/op-form'
import { OpResult } from '@/tools/operations/components/op-result'
import {
  describeResolutionFailure,
  resolveWirePath,
} from '@/tools/operations/lib/resolve-wire-path'

// Wire shape of `/kernel.astrale.ai/interface.Function/list` — mirrors
// `functionSchema` (kernel/core/domain/compile/method/serialized.ts).
interface FunctionEntry {
  ref: string // e.g. "class.Class.method.init" or "interface.Container.method.push"
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  code?: unknown
  isStatic?: boolean
  output?: string
  inheritance?: string
  binding?: unknown
  environment?: string
}

interface ClassEntry {
  id: string
  name: string
  operations: OpEntry[]
}

// `ref` format: "<class|interface>.<Name>.method.<methodName>".
function parseRef(ref: string): { namespace: string; methodName: string } | null {
  const idx = ref.indexOf('.method.')
  if (idx === -1) return null
  return { namespace: ref.slice(0, idx), methodName: ref.slice(idx + '.method.'.length) }
}

function jsonSchemaToParams(schema?: Record<string, unknown>): ParamField[] {
  if (!schema) return []

  // Standard JSON Schema with type: "object" and properties
  if (schema.type === 'object' && schema.properties) {
    return parseProperties(
      schema.properties as Record<string, Record<string, unknown>>,
      (schema.required ?? []) as string[],
    )
  }

  // Flat kernel schema: { paramName: { $nodeRef: "Class" } | { type: "string" } | ... }
  // Detect by checking if there's no "type" key at root level
  if (!schema.type) {
    return parseProperties(schema as Record<string, Record<string, unknown>>, [])
  }

  return []
}

function parseProperties(
  properties: Record<string, Record<string, unknown>>,
  required: string[],
): ParamField[] {
  return Object.entries(properties).map(([name, prop]) => {
    // Handle $nodeRef references
    if (prop.$nodeRef) {
      return {
        name,
        type: 'nodeRef' as const,
        required: required.includes(name),
        description: `${prop.$nodeRef} reference`,
        nodeRefClass: prop.$nodeRef as string,
      }
    }

    const field: ParamField = {
      name,
      type: (prop.type as ParamField['type']) ?? 'object',
      required: required.includes(name),
      description: prop.description as string | undefined,
      default: prop.default,
    }
    if (prop.enum) {
      field.type = 'enum'
      field.enumValues = prop.enum as string[]
    }
    return field
  })
}

function groupOperations(ops: FunctionEntry[], graph: BusinessGraph | null): ClassEntry[] {
  const grouped = new Map<
    string,
    { name: string; ops: Array<{ op: FunctionEntry; methodName: string }> }
  >()

  for (const op of ops) {
    const parsed = parseRef(op.ref)
    if (!parsed) continue
    const { namespace, methodName } = parsed

    let group = grouped.get(namespace)
    if (!group) {
      group = { name: namespace, ops: [] }
      grouped.set(namespace, group)
    }
    group.ops.push({ op, methodName })
  }

  return [...grouped.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => ({
      id: g.name,
      name: g.name,
      operations: g.ops
        .sort((a, b) => a.methodName.localeCompare(b.methodName))
        .map(({ op, methodName }) => toOpEntry(op, g.name, methodName, graph)),
    }))
}

function toOpEntry(
  op: FunctionEntry,
  namespace: string,
  methodName: string,
  graph: BusinessGraph | null,
): OpEntry {
  const base = {
    namespace,
    key: methodName,
    description: op.inheritance ? `[${op.inheritance}]` : '',
    params: jsonSchemaToParams(op.inputSchema),
    isStatic: op.isStatic,
  }

  if (!graph) {
    return { ...base, wireName: '', disabled: true, disabledReason: 'Graph not loaded' }
  }

  const resolution = resolveWirePath(op.ref, graph)
  if (resolution.kind === 'ok') {
    return { ...base, wireName: resolution.path }
  }
  return {
    ...base,
    wireName: '',
    disabled: true,
    disabledReason: describeResolutionFailure(resolution),
  }
}

export function OperationsPanel() {
  const workspace = useWorkspace()
  const connection = useConnection()
  const [operations, setOperations] = useState<FunctionEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedOp, setSelectedOp] = useState<OpEntry | null>(null)
  const [opResult, setOpResult] = useState<OpCallResult | null>(null)

  const graphState = workspace.graphState

  useEffect(() => {
    if (connection.status !== 'connected') {
      setOperations([])
      return
    }

    setLoading(true)
    setError(null)
    connection
      .call<FunctionEntry[]>('/kernel.astrale.ai/interface.Function/list', {})
      .then((result: unknown) => {
        const ops = Array.isArray(result) ? result : (result as Record<string, unknown>)?.items
        if (Array.isArray(ops)) {
          setOperations(ops.filter((o): o is FunctionEntry => !!o && typeof o.ref === 'string'))
        }
      })
      .catch((err) => {
        // oxlint-disable-next-line no-console
        console.warn('[OperationsPanel] Failed to load operations:', err)
        setError(err instanceof Error ? err.message : 'Failed to load operations')
      })
      .finally(() => setLoading(false))
  }, [connection.status, graphState]) // eslint-disable-line react-hooks/exhaustive-deps

  const businessGraph = useMemo(
    () => (workspace.graphState ? rawToBusiness(workspace.graphState) : null),
    [workspace.graphState],
  )

  const classes = useMemo(
    () => groupOperations(operations, businessGraph),
    [operations, businessGraph],
  )
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set())

  function toggleClass(classId: string) {
    setExpandedClasses((prev) => {
      const next = new Set(prev)
      if (next.has(classId)) next.delete(classId)
      else next.add(classId)
      return next
    })
  }

  function handleSelect(op: OpEntry) {
    setSelectedOp(op)
    setOpResult(null)
  }

  function handleResult(result: OpCallResult) {
    setOpResult(result)
    workspace.appendLog({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      level: result.error ? 'error' : 'success',
      message: `${selectedOp?.wireName}: ${result.error ? 'Error' : 'OK'}`,
      data: result.error ?? result.data,
    })
  }

  if (connection.status !== 'connected') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Connect to a kernel to load operations
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading operations...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className="w-56 shrink-0 overflow-auto border-r border-border">
        {classes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No operations found
          </div>
        ) : (
          classes.map((cls) => (
            <div key={cls.id}>
              <button
                onClick={() => toggleClass(cls.id)}
                className="flex w-full items-center gap-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <span
                  className={cn(
                    'transition-transform text-[8px]',
                    expandedClasses.has(cls.id) ? 'rotate-90' : '',
                  )}
                >
                  ▶
                </span>
                {cls.name}
                <span className="ml-auto text-[9px] font-normal normal-case tracking-normal opacity-60">
                  {cls.operations.length}
                </span>
              </button>
              {expandedClasses.has(cls.id) &&
                cls.operations.map((op) => (
                  <button
                    key={`${op.namespace}/${op.key}`}
                    onClick={() => handleSelect(op)}
                    title={op.disabled ? op.disabledReason : undefined}
                    className={cn(
                      'block w-full pl-6 pr-3 py-1.5 text-left text-xs transition-colors',
                      selectedOp?.namespace === op.namespace && selectedOp?.key === op.key
                        ? 'bg-accent text-accent-foreground font-medium'
                        : 'text-foreground hover:bg-accent/50',
                      op.disabled && 'opacity-50 italic',
                    )}
                  >
                    <span className="text-muted-foreground">{cls.name}.</span>
                    {op.key}
                  </button>
                ))}
            </div>
          ))
        )}
      </div>

      <div className="flex-1 overflow-auto p-3">
        {selectedOp ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">
                {selectedOp.wireName || `${selectedOp.namespace}.${selectedOp.key}`}
              </h3>
              {selectedOp.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{selectedOp.description}</p>
              )}
            </div>
            <OpForm op={selectedOp} onResult={handleResult} />
            {opResult && <OpResult result={opResult} />}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select an operation from the list
          </div>
        )}
      </div>
    </div>
  )
}
