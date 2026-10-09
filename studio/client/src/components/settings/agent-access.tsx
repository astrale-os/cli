import { AGENT_ACCESS_LEVELS, type AgentAccess } from '@shared/types'

import { SettingSelect } from './row'

const ACCESS_LABELS: Record<AgentAccess, string> = {
  workspace: 'Workspace',
  full: 'Full automation',
}

/** The level a saved value maps to: itself when offered, else full automation, else the first. */
export function resolveAgentAccess(
  value: string | undefined,
  levels: readonly AgentAccess[],
): AgentAccess | undefined {
  if (levels.includes(value as AgentAccess)) return value as AgentAccess
  return levels.includes('full') ? 'full' : levels[0]
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
  const current = resolveAgentAccess(
    AGENT_ACCESS_LEVELS.includes(value as AgentAccess) ? value : undefined,
    levels,
  )
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
