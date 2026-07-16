import { effectiveAgentEffort } from '@shared/agent-effort'
import { AGENT_ACCESS_LEVELS, type AgentAccess, type AgentEffort } from '@shared/types'

import { cn } from '@/lib/utils'

const EFFORT_LABELS: Record<AgentEffort, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-high',
  max: 'Max',
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
    <div
      className="grid grid-cols-3 gap-1 rounded-md bg-muted/45 p-1 sm:grid-cols-6"
      role="radiogroup"
      aria-label="Agent effort"
    >
      {levels.map((effort) => (
        <button
          key={effort}
          type="button"
          role="radio"
          aria-checked={current === effort}
          onClick={() => onChange(effort)}
          className={cn(
            'min-w-0 rounded px-1.5 py-1 text-center text-[11px] font-medium transition-colors',
            current === effort
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
          )}
        >
          {EFFORT_LABELS[effort]}
        </button>
      ))}
    </div>
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
    <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/45 p-1" role="radiogroup">
      {levels.map((access) => (
        <button
          key={access}
          type="button"
          role="radio"
          aria-checked={current === access}
          onClick={() => onChange(access)}
          className={cn(
            'rounded px-2 py-1 text-center text-[11px] font-medium transition-colors',
            current === access
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
          )}
        >
          {ACCESS_LABELS[access]}
        </button>
      ))}
    </div>
  )
}
