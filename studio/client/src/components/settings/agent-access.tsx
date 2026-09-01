import { AGENT_ACCESS_LEVELS, type AgentAccess } from '@shared/types'

import { SettingSelect } from './row'

const ACCESS_LABELS: Record<AgentAccess, string> = {
  workspace: 'Workspace',
  full: 'Full automation',
}

export function AgentAccessPicker({
  value,
  levels,
  onChange,
}: {
  value?: string
  levels: readonly AgentAccess[]
  onChange: (value: AgentAccess) => void
}) {
  const current =
    AGENT_ACCESS_LEVELS.includes(value as AgentAccess) && levels.includes(value as AgentAccess)
      ? (value as AgentAccess)
      : levels.includes('full')
        ? 'full'
        : levels[0]
  return (
    <SettingSelect
      aria-label="Agent access"
      value={current}
      onChange={(event) => onChange(event.target.value as AgentAccess)}
    >
      {levels.map((access) => (
        <option key={access} value={access}>
          {ACCESS_LABELS[access]}
        </option>
      ))}
    </SettingSelect>
  )
}
