import type { HarnessLoadout, HarnessModelOption } from '@shared/types'

import { SettingsHint } from './hint'

/** Per-domain model override for the currently selected harness. */
export function AgentModel({
  selected,
  loadout,
  modelOptions,
  onChange,
}: {
  selected: string
  loadout?: HarnessLoadout
  modelOptions?: readonly HarnessModelOption[]
  onChange: (model: string) => void
}) {
  const options = loadout?.models ?? modelOptions ?? []
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
      <input
        aria-label="Agent model"
        list={options.length > 0 ? 'agent-model-options' : undefined}
        value={selected}
        onChange={(event) => onChange(event.target.value)}
        placeholder={
          loadout?.nativeModel
            ? `Default — ${loadout.nativeModel}`
            : 'Default — choose an alias or type a full model id'
        }
        spellCheck={false}
        className="w-full rounded-md border bg-background px-2 py-1 font-mono text-[12px] outline-none focus:border-primary"
      />
      {options.length > 0 && (
        <datalist id="agent-model-options">
          {options.map((model) => (
            <option
              key={model.id}
              value={model.id}
              label={`${model.label}${model.isDefault ? ' — catalog default' : ''}`}
            />
          ))}
        </datalist>
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
