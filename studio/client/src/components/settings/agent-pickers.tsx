import { effectiveAgentEffort } from '@shared/agent-effort'
import { AGENT_ACCESS_LEVELS, type AgentAccess, type AgentEffort } from '@shared/types'

import { SettingSelect } from './row'

const EFFORT_LABELS: Record<AgentEffort, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-high',
  max: 'Max',
  ultracode: 'Ultracode',
}

const ACCESS_LABELS: Record<AgentAccess, string> = {
  workspace: 'Workspace',
  full: 'Full automation',
}

export function AgentEffortPicker({
  value,
  levels,
  onChange,
}: {
  value?: string
  levels: readonly AgentEffort[]
  onChange: (value: AgentEffort) => void
}) {
  const current = effectiveAgentEffort(levels, value)
  return (
    <SettingSelect
      aria-label="Agent effort"
      value={current ?? ''}
      onChange={(event) => onChange(event.target.value as AgentEffort)}
    >
      {levels.map((effort) => (
        <option key={effort} value={effort}>
          {EFFORT_LABELS[effort]}
        </option>
      ))}
    </SettingSelect>
  )
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
