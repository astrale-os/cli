import { Crosshair } from 'lucide-react'

import type { ParamField } from '../lib/op-registry'

interface ParamFieldInputProps {
  field: ParamField
  value: unknown
  onChange: (value: unknown) => void
  onPickNode?: (fieldKey: string, resolve: (nodeId: string) => void) => void
}

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function ParamFieldInput({ field, value, onChange, onPickNode }: ParamFieldInputProps) {
  const label = (
    <label className="text-xs font-medium text-foreground">
      {field.name}
      {field.required && <span className="text-destructive ml-0.5">*</span>}
      {field.description && (
        <span className="ml-1.5 font-normal text-muted-foreground">{field.description}</span>
      )}
    </label>
  )

  if (field.type === 'nodeRef') {
    return (
      <div className="space-y-1">
        <label className="text-xs font-medium text-foreground">
          {field.name}
          {field.required && <span className="text-destructive ml-0.5">*</span>}
          {field.nodeRefClass && (
            <span className="ml-1.5 font-normal text-muted-foreground">
              {field.nodeRefClass} reference
            </span>
          )}
        </label>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Node ID or path"
            className={`${inputClass} font-mono`}
          />
          {onPickNode && (
            <button
              type="button"
              onClick={() => onPickNode(field.name, (nodeId) => onChange(nodeId))}
              title="Pick from graph"
              className="shrink-0 rounded-md border border-input bg-background px-2 text-muted-foreground hover:text-primary hover:border-primary transition-colors"
            >
              <Crosshair className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    )
  }

  if (field.type === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        {label}
      </div>
    )
  }

  if (field.type === 'enum' && field.enumValues) {
    return (
      <div className="space-y-1">
        {label}
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        >
          {field.enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (field.type === 'number') {
    return (
      <div className="space-y-1">
        {label}
        <input
          type="number"
          value={value === '' || value === undefined ? '' : Number(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder={field.name}
          className={inputClass}
        />
      </div>
    )
  }

  if (field.type === 'object') {
    if (field.properties?.length) {
      return (
        <fieldset className="space-y-2 rounded-md border border-border p-2">
          <legend className="px-1 text-xs font-medium text-foreground">
            {field.name}
            {field.required && <span className="text-destructive ml-0.5">*</span>}
          </legend>
          {field.properties.map((sub) => (
            <ParamFieldInput
              key={sub.name}
              field={sub}
              value={(value as Record<string, unknown> | undefined)?.[sub.name]}
              onChange={(v) =>
                onChange({ ...(value as Record<string, unknown> | undefined), [sub.name]: v })
              }
            />
          ))}
        </fieldset>
      )
    }
    // Unstructured object — JSON textarea fallback
    return (
      <div className="space-y-1">
        {label}
        <textarea
          value={typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value))
            } catch {
              onChange(e.target.value)
            }
          }}
          placeholder="{}"
          rows={3}
          className={`${inputClass} font-mono`}
        />
      </div>
    )
  }

  if (field.type === 'array') {
    return (
      <div className="space-y-1">
        {label}
        <textarea
          value={typeof value === 'string' ? value : JSON.stringify(value ?? [], null, 2)}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value))
            } catch {
              onChange(e.target.value)
            }
          }}
          placeholder="[]"
          rows={3}
          className={`${inputClass} font-mono`}
        />
      </div>
    )
  }

  // Default: string
  return (
    <div className="space-y-1">
      {label}
      <input
        type="text"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.name}
        className={inputClass}
      />
    </div>
  )
}
