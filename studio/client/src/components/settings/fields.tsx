import type { StudioSettings } from '@shared/types'

import {
  parseStudioNumericSetting,
  STUDIO_NUMERIC_LIMITS,
  type NumericStudioSetting,
} from '@shared/settings-values'

import { SettingsHint } from './hint'

interface FieldDef {
  key: keyof StudioSettings
  label: string
  hint: string
  type: 'text' | 'number'
  placeholder?: string
}

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Performance',
    fields: [
      {
        key: 'introspectTimeoutMs',
        label: 'Schema extraction timeout',
        hint: 'How long the Bun introspector may run before it is killed (ms). Raise for very large domains.',
        type: 'number',
        placeholder: '60000',
      },
      {
        key: 'instancePollMs',
        label: 'Instance status poll',
        hint: 'How often the deploy / instance status refreshes (ms). Raise to make fewer CLI calls.',
        type: 'number',
        placeholder: '30000',
      },
      {
        key: 'updatesPollMs',
        label: 'Updates check interval',
        hint: 'How often the studio re-checks for stale schema / available updates (ms).',
        type: 'number',
        placeholder: '600000',
      },
      {
        key: 'viewProbeTimeoutMs',
        label: 'View URL probe timeout',
        hint: 'How long to wait when resolving a live view URL from the instance (ms).',
        type: 'number',
        placeholder: '8000',
      },
    ],
  },
  {
    title: 'Detection',
    fields: [
      {
        key: 'integrationsDir',
        label: 'Integrations folder',
        hint: 'Folder under the domain root scanned for integrations.',
        type: 'text',
        placeholder: 'integrations',
      },
    ],
  },
]

export function generalSettingsPatch(
  values: Record<string, string>,
  current: StudioSettings,
): Partial<StudioSettings> {
  const patch: Record<string, unknown> = {}
  for (const section of SECTIONS)
    for (const field of section.fields) {
      const raw = values[field.key] ?? ''
      if (field.type === 'number') {
        const value = parseStudioNumericSetting(field.key as NumericStudioSetting, raw)
        if (value === null)
          throw new Error(
            `${field.label} must be a whole number from ${STUDIO_NUMERIC_LIMITS[field.key as NumericStudioSetting].min} to ${STUDIO_NUMERIC_LIMITS[field.key as NumericStudioSetting].max} ms`,
          )
        patch[field.key] = value
      } else {
        patch[field.key] = raw.trim() || (current[field.key] as string)
      }
    }
  return patch as Partial<StudioSettings>
}

export function SettingsFields({
  values,
  onChange,
}: {
  values: Record<string, string>
  onChange: (key: keyof StudioSettings, value: string) => void
}) {
  return SECTIONS.map((section) => (
    <div key={section.title}>
      <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {section.title}
      </div>
      <div className="divide-y divide-border rounded-lg border bg-card">
        {section.fields.map((field) => (
          <div key={field.key} className="flex items-center gap-3 px-3 py-2">
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
              <span className="truncate">{field.label}</span>
              <SettingsHint text={field.hint} />
            </span>
            <input
              type={field.type}
              min={
                field.type === 'number'
                  ? STUDIO_NUMERIC_LIMITS[field.key as NumericStudioSetting].min
                  : undefined
              }
              max={
                field.type === 'number'
                  ? STUDIO_NUMERIC_LIMITS[field.key as NumericStudioSetting].max
                  : undefined
              }
              step={field.type === 'number' ? 1 : undefined}
              value={values[field.key] ?? ''}
              onChange={(event) => onChange(field.key, event.target.value)}
              placeholder={field.placeholder}
              className="w-32 shrink-0 rounded-md border bg-card px-2 py-1 text-right font-mono text-[13px] outline-none focus:border-primary"
            />
          </div>
        ))}
      </div>
    </div>
  ))
}
