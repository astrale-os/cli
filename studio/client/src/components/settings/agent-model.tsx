import type { HarnessLoadout, HarnessModelOption } from '@shared/types'

import { SettingRow, SettingSelect } from './row'

/** Per-domain model override, picked from what the selected harness offers. */
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
  const harnessDefault = loadout?.nativeModel ?? loadout?.model
  // A saved override the harness no longer lists must stay selectable, or saving
  // this dialog would silently change the model.
  const unlisted = selected && !options.some((model) => model.id === selected) ? selected : null
  return (
    <SettingRow label="Model">
      <SettingSelect
        aria-label="Agent model"
        value={selected}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {harnessDefault ? `Default — ${harnessDefault}` : 'Harness default'}
        </option>
        {options.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
            {model.isDefault ? ' — default' : ''}
          </option>
        ))}
        {unlisted && <option value={unlisted}>{unlisted}</option>}
      </SettingSelect>
    </SettingRow>
  )
}
