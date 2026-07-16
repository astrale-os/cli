import type { HarnessLoadout, HarnessModelOption } from '@shared/types'

import { useState } from 'react'

import { SettingsHint } from './hint'

export const CUSTOM_MODEL_OPTION = '__custom_model__'

/** Per-domain model override for the currently selected harness. */
export function AgentModel({
  selected,
  loadout,
  modelOptions,
  allowCustomModel,
  onChange,
}: {
  selected: string
  loadout?: HarnessLoadout
  modelOptions?: readonly HarnessModelOption[]
  allowCustomModel?: boolean
  onChange: (model: string) => void
}) {
  const options = loadout?.models ?? modelOptions ?? []
  const [customMode, setCustomMode] = useState(false)
  const knownSelection = options.some((model) => model.id === selected)
  const customSelection = !!selected && !knownSelection
  const showingCustom = allowCustomModel && (customMode || customSelection)
  const effective = selected || loadout?.model || 'harness default'
  return (
    <div className="space-y-1.5 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[13px]">
        <span>Model</span>
        <SettingsHint text="Leave this on Default to preserve the selected harness's own config and account default. An explicit choice is remembered independently for this domain and harness, then passed as --model to normal turns, resumed turns, and Ask forks." />
        <span className="ml-auto max-w-[55%] truncate font-mono text-[11px] text-muted-foreground/70">
          {effective}
        </span>
      </div>
      {options.length > 0 ? (
        <div className="space-y-1.5">
          <select
            aria-label="Agent model"
            value={showingCustom ? CUSTOM_MODEL_OPTION : selected}
            onChange={(event) => {
              const value = event.target.value
              if (value === CUSTOM_MODEL_OPTION) {
                setCustomMode(true)
                if (!customSelection) onChange('')
              } else {
                setCustomMode(false)
                onChange(value)
              }
            }}
            className="w-full rounded-md border bg-background px-2 py-1 text-[12px] outline-none focus:border-primary"
          >
            <option value="">
              Default
              {loadout?.nativeModel ? ` — ${loadout.nativeModel}` : ''}
            </option>
            {options.map((model) => (
              <option key={model.id} value={model.id} title={model.description}>
                {model.label}
                {model.isDefault ? ' — catalog default' : ''}
              </option>
            ))}
            {allowCustomModel && <option value={CUSTOM_MODEL_OPTION}>Custom model ID…</option>}
          </select>
          {showingCustom && (
            <input
              value={customSelection ? selected : ''}
              onChange={(event) => onChange(event.target.value)}
              placeholder="Alias or full model ID"
              aria-label="Custom model ID"
              spellCheck={false}
              autoFocus
              className="w-full rounded-md border bg-background px-2 py-1 font-mono text-[12px] outline-none placeholder:text-muted-foreground/40 focus:border-primary"
            />
          )}
        </div>
      ) : (
        <input
          aria-label="Agent model"
          value={selected}
          onChange={(event) => onChange(event.target.value)}
          placeholder={
            loadout?.nativeModel
              ? `Default — ${loadout.nativeModel}`
              : 'Default — type an alias or full model id to override'
          }
          spellCheck={false}
          className="w-full rounded-md border bg-background px-2 py-1 font-mono text-[12px] outline-none focus:border-primary"
        />
      )}
      <p className="text-[10px] text-muted-foreground/50">
        {selected
          ? 'Studio override · saved when you press Save'
          : loadout?.modelSource === 'config'
            ? 'Codex effective config'
            : loadout?.modelSource === 'default'
              ? 'Harness catalog default'
              : loadout?.modelSource === 'runtime'
                ? 'Harness runtime default'
                : 'Harness-native selection'}
      </p>
    </div>
  )
}
