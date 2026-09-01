import type { HarnessLoadout } from '@shared/types'

import { SettingRow, SettingSelect } from './row'

/** The domain's default model for NEW chats — each open chat picks its own. */
export function AgentModel({
  selected,
  loadout,
  onChange,
}: {
  selected: string
  loadout?: HarnessLoadout
  onChange: (model: string) => void
}) {
  const options = loadout?.models ?? []
  // `loadout.model` is what the probe ran with — Studio's own default for this
  // harness, which is the model an unpinned chat gets. Named by its catalog
  // label, since a slug like `opus[1m]` is not what the list next to it says.
  const effective = loadout?.model ?? loadout?.nativeModel
  const harnessDefault = options.find((model) => model.id === effective)?.label ?? effective
  // A saved override the harness no longer lists must stay selectable, or saving
  // this dialog would silently change the model.
  const unlisted = selected && !options.some((model) => model.id === selected) ? selected : null
  return (
    <SettingRow
      label="Default model"
      description="Applies to new chats; each open chat can pick another model of its own agent."
    >
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
