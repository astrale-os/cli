import { useEffect, useMemo, useState } from 'react'

import type { OpEntry, ParamField } from '@/tools/operations/lib/op-registry'

import { useConnection } from '@/hooks/use-connection'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'
import { OpForm, type OpCallResult } from '@/tools/operations/components/op-form'
import { OpResult } from '@/tools/operations/components/op-result'

const UNKNOWN_DOMAIN = '?'

interface OperationEntry {
  name: string
  inputSchema?: string
  outputSchema?: string
  access?: string
  isStatic?: boolean
  owner?: string
  domain?: string
}

interface NodeMethodsProps {
  nodeId: string
  className: string
}

function jsonSchemaToParams(raw?: string): ParamField[] {
  if (!raw) return []
  let schema: Record<string, unknown>
  try {
    schema = JSON.parse(raw)
  } catch {
    return []
  }

  if (schema.type === 'object' && schema.properties) {
    return parseProperties(
      schema.properties as Record<string, Record<string, unknown>>,
      (schema.required ?? []) as string[],
    )
  }

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

export function NodeMethods({ nodeId, className }: NodeMethodsProps) {
  const { status, call } = useConnection()
  const workspace = useWorkspace()
  const [operations, setOperations] = useState<OperationEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedOp, setSelectedOp] = useState<OpEntry | null>(null)
  const [opResult, setOpResult] = useState<OpCallResult | null>(null)

  useEffect(() => {
    if (status !== 'connected') {
      setOperations([])
      return
    }

    setLoading(true)
    call<OperationEntry[]>('/kernel.astrale.ai/interface.Function/list', {})
      .then((result: unknown) => {
        const ops = Array.isArray(result) ? result : (result as Record<string, unknown>)?.items
        if (Array.isArray(ops)) {
          setOperations(ops.filter((o): o is OperationEntry => o && typeof o.name === 'string'))
        }
      })
      .catch(() => {
        // silently fail — methods section is supplementary
      })
      .finally(() => setLoading(false))
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const methods = useMemo(() => {
    return operations
      .filter((op) => {
        if (op.owner) return op.owner === className
        const dotIndex = op.name.indexOf('.')
        if (dotIndex <= 0) return false
        return op.name.slice(0, dotIndex) === className
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((op): OpEntry => {
        const dotIndex = op.name.indexOf('.')
        const key = dotIndex > 0 ? op.name.slice(dotIndex + 1) : op.name
        return {
          namespace: className,
          key,
          wireName: `/${op.domain ?? UNKNOWN_DOMAIN}/${className}/${key}`,
          description: op.access ? `[${op.access}]` : '',
          params: jsonSchemaToParams(op.inputSchema),
          isStatic: op.isStatic,
        }
      })
  }, [operations, className])

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

  if (status !== 'connected') {
    return <p className="text-xs text-muted-foreground">Connect to load methods</p>
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading...</p>
  }

  if (methods.length === 0) {
    return <p className="text-xs text-muted-foreground">No methods for {className}</p>
  }

  return (
    <div className="space-y-2">
      {/* Method list */}
      <div className="rounded-lg border border-border divide-y divide-border bg-muted/30">
        {methods.map((op) => (
          <button
            key={op.wireName}
            onClick={() => handleSelect(op)}
            className={cn(
              'block w-full px-3 py-1.5 text-left text-xs transition-colors',
              selectedOp?.wireName === op.wireName
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-foreground hover:bg-accent/50',
            )}
          >
            <span className="font-mono">{op.key}</span>
            {op.description && (
              <span className="ml-1.5 text-muted-foreground">{op.description}</span>
            )}
          </button>
        ))}
      </div>

      {/* Selected method form */}
      {selectedOp && (
        <div className="space-y-3 pt-1">
          <div>
            <h4 className="text-xs font-semibold">{selectedOp.key}</h4>
            <p className="text-[10px] text-muted-foreground font-mono">{selectedOp.wireName}</p>
          </div>
          <OpForm
            op={{
              ...selectedOp,
              // For instance methods, pre-fill nodeId by making the op non-static
              // and passing nodeId through the form's default behavior
              isStatic: selectedOp.isStatic,
            }}
            onResult={handleResult}
            defaultNodeId={nodeId}
          />
          {opResult && <OpResult result={opResult} />}
        </div>
      )}
    </div>
  )
}
