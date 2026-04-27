import { Crosshair } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'

import { useConnection } from '@/hooks/use-connection'
import { useWorkspace } from '@/hooks/use-workspace'
import { cn } from '@/lib/utils'

import type { OpEntry } from '../lib/op-registry'

import { buildDefaults } from '../lib/op-registry'
import { ParamFieldInput } from './param-field'

export interface OpCallResult {
  data?: unknown
  error?: string
  /** True when routed mode was requested but the function has no route binding */
  routedFallback?: boolean
}

interface OpFormProps {
  op: OpEntry
  onResult: (result: OpCallResult) => void
  /** Pre-fill the nodeId field for instance methods */
  defaultNodeId?: string
}

export function OpForm({ op, onResult, defaultNodeId }: OpFormProps) {
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({})
  const [nodeId, setNodeId] = useState('')
  const [paramsJson, setParamsJson] = useState('{}')
  const [loading, setLoading] = useState(false)
  const { status, call, bindingMode, hasRouteBinding } = useConnection()
  const workspace = useWorkspace()
  const isConnected = status === 'connected'

  const needsSelf = !op.isStatic

  // Reset form when operation changes
  useEffect(() => {
    setFieldValues(buildDefaults(op.params))
    setNodeId(defaultNodeId ?? '')
    setParamsJson('{}')
  }, [op.wireName]) // eslint-disable-line react-hooks/exhaustive-deps

  function getParams(): Record<string, unknown> {
    const params = { ...fieldValues }
    // Strip empty optional strings
    for (const p of op.params) {
      if (!p.required && params[p.name] === '') {
        delete params[p.name]
      }
    }
    return params
  }

  function handleModeSwitch(newMode: 'form' | 'json') {
    if (newMode === 'json' && mode === 'form') {
      setParamsJson(JSON.stringify(getParams(), null, 2))
    }
    if (newMode === 'form' && mode === 'json') {
      try {
        const parsed = JSON.parse(paramsJson) as Record<string, unknown>
        const { nodeId: nid, ...rest } = parsed
        if (needsSelf && typeof nid === 'string') setNodeId(nid)
        setFieldValues({ ...buildDefaults(op.params), ...rest })
      } catch {
        // Keep current form values if JSON is invalid
      }
    }
    setMode(newMode)
  }

  function handleFieldChange(name: string, value: unknown) {
    setFieldValues((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isConnected || op.disabled) return

    setLoading(true)
    try {
      const params = mode === 'json' ? JSON.parse(paramsJson) : getParams()
      const method =
        needsSelf && nodeId
          ? `${nodeId.startsWith('/') || nodeId.startsWith('@') ? nodeId : `@${nodeId}`}:${op.key}`
          : op.wireName
      const routedFallback = bindingMode === 'auto' && !hasRouteBinding(method)
      const data = await call(method, params)
      onResult({ data, routedFallback })
    } catch (err) {
      const routedFallback = bindingMode === 'auto' && !hasRouteBinding(op.wireName)
      onResult({ error: err instanceof Error ? err.message : 'Unknown error', routedFallback })
    } finally {
      setLoading(false)
    }
  }

  const onPickNode = useCallback(
    (fieldKey: string, resolve: (nodeId: string) => void) => {
      workspace.startNodePicker(fieldKey, resolve)
    },
    [workspace],
  )

  const hasFields = op.params.length > 0 || needsSelf

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Mode toggle */}
      <div className="flex gap-1 rounded-md bg-muted p-0.5 w-fit">
        <button
          type="button"
          onClick={() => handleModeSwitch('form')}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            mode === 'form'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Form
        </button>
        <button
          type="button"
          onClick={() => handleModeSwitch('json')}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            mode === 'json'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          JSON
        </button>
      </div>

      {mode === 'form' ? (
        <div className="space-y-3">
          {/* Node ID field for instance (non-static) operations */}
          {needsSelf && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                nodeId
                <span className="text-destructive ml-0.5">*</span>
                <span className="ml-1.5 font-normal text-muted-foreground">
                  target node to operate on
                </span>
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                  placeholder="Node ID or path"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  onClick={() => onPickNode('nodeId', (id) => setNodeId(id))}
                  title="Pick from graph"
                  className="shrink-0 rounded-md border border-input bg-background px-2 text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                >
                  <Crosshair className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Auto-generated param fields */}
          {op.params.map((field) => (
            <ParamFieldInput
              key={field.name}
              field={field}
              value={fieldValues[field.name]}
              onChange={(v) => handleFieldChange(field.name, v)}
              onPickNode={field.type === 'nodeRef' ? onPickNode : undefined}
            />
          ))}

          {!hasFields && <p className="text-xs text-muted-foreground">No parameters required.</p>}
        </div>
      ) : (
        <div>
          <label htmlFor="params-json" className="text-xs font-medium">
            Parameters (JSON)
          </label>
          <textarea
            id="params-json"
            value={paramsJson}
            onChange={(e) => setParamsJson(e.target.value)}
            className="mt-1 h-32 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={!isConnected || loading || op.disabled}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {loading
          ? 'Executing...'
          : op.disabled
            ? 'Unavailable'
            : isConnected
              ? 'Execute'
              : 'Not connected'}
      </button>

      {!isConnected && (
        <p className="text-xs text-muted-foreground">
          Connect to a kernel instance to execute operations.
        </p>
      )}

      {op.disabled && op.disabledReason && (
        <p className="text-xs text-muted-foreground">{op.disabledReason}</p>
      )}
    </form>
  )
}
