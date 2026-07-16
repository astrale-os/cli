import type { Dispatch, SetStateAction } from 'react'

import { effectiveAgentEffort } from '@shared/agent-effort'
import { updateAgentModel } from '@shared/agent-models'
import {
  AGENT_ACCESS_LEVELS,
  AGENT_EFFORT_LEVELS,
  type AgentAccess,
  type HarnessStatus,
  type StudioSettings,
} from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { useLoadout, useUsage } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { AgentModel } from './agent-model'
import { agentEffortLabel, AgentAccessPicker, AgentEffortPicker } from './agent-pickers'
import { AgentSession } from './agent-session'
import { SettingsHint } from './hint'
import { AgentLoadout } from './loadout'

export interface AgentSettingsProps {
  domainId?: string
  settings?: StudioSettings
  harness?: HarnessStatus
  values: Record<string, string>
  setValues: Dispatch<SetStateAction<Record<string, string>>>
  agentModels: Record<string, string>
  setAgentModels: Dispatch<SetStateAction<Record<string, string>>>
}

/** Harness, model, effort, access, conversation, and loadout settings. */
export function AgentSettings({
  domainId,
  settings,
  harness,
  values,
  setValues,
  agentModels,
  setAgentModels,
}: AgentSettingsProps) {
  const { data: loadout, isFetching: loadoutFetching, error: loadoutError } = useLoadout(domainId)
  const { data: usage } = useUsage(domainId)
  const queryClient = useQueryClient()
  const effortLevels = harness?.capabilities.effortLevels ?? [...AGENT_EFFORT_LEVELS]
  const accessLevels = harness?.capabilities.accessLevels ?? [...AGENT_ACCESS_LEVELS]
  const effortLabels = harness?.capabilities.effortLabels
  const shownEffort = effectiveAgentEffort(
    effortLevels,
    values.agentEffort ?? settings?.agentEffort,
  )

  const selectHarness = useMutation({
    mutationFn: (input: { domainId: string; harness: string }) =>
      api.selectHarness(input.domainId, input.harness),
    onSuccess: (selected, input) => {
      queryClient.setQueryData(qk.harness(input.domainId), selected)
      queryClient.setQueryData(qk.agentSession(input.domainId), undefined)
      queryClient.setQueryData(qk.loadout(input.domainId), undefined)
      queryClient.invalidateQueries({ queryKey: qk.harness(input.domainId) })
      queryClient.invalidateQueries({ queryKey: qk.agentSession(input.domainId) })
      queryClient.invalidateQueries({ queryKey: qk.agent(input.domainId) })
      queryClient.invalidateQueries({ queryKey: qk.loadout(input.domainId) })
      toast.success(`Using ${selected.label}`)
    },
    onError: (error) => toast.error(String(error)),
  })

  const refreshLoadout = useMutation({
    mutationFn: (id: string) => api.loadout(id, true),
    onSuccess: (refreshed, id) => queryClient.setQueryData(qk.loadout(id), refreshed),
    onError: (error) => toast.error(String(error)),
  })

  const harnessOptions = harness?.options ?? [{ id: 'claude', label: 'Claude Code (local)' }]
  const harnessId = harness?.id ?? 'claude'
  const selectedModel = agentModels[harnessId] ?? ''
  const setSelectedModel = (model: string) =>
    setAgentModels((current) => updateAgentModel(current, harnessId, model))

  return (
    <div>
      <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        Agent
      </div>
      <div className="divide-y divide-border/50 rounded-lg border bg-card/40">
        <div className="space-y-2 px-3 py-2.5">
          <div className="flex items-center gap-3">
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
              <span className="truncate">Harness</span>
              <SettingsHint text="Which installed local coding agent handles Studio turns. Conversations are preserved independently per harness." />
            </span>
            <div className="flex items-center gap-1.5">
              {harness?.locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
              <select
                disabled={!domainId || !harness || harness.locked || selectHarness.isPending}
                value={harness?.id ?? 'claude'}
                onChange={(event) =>
                  selectHarness.mutate({ domainId: domainId!, harness: event.target.value })
                }
                className="w-40 shrink-0 rounded-md border bg-background px-2 py-1 text-[13px] outline-none disabled:cursor-not-allowed disabled:text-muted-foreground"
              >
                {harnessOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                !harness
                  ? 'bg-muted-foreground/30'
                  : harness.ok
                    ? 'bg-emerald-500'
                    : 'bg-destructive',
              )}
            />
            <span
              className={cn(
                'truncate',
                harness && !harness.ok
                  ? 'font-medium text-destructive'
                  : 'text-muted-foreground/70',
              )}
            >
              {harness ? harness.message : 'Checking…'}
            </span>
            {harness?.locked && (
              <span className="ml-auto shrink-0 text-muted-foreground/50">locked by --harness</span>
            )}
          </div>
        </div>

        <AgentModel
          key={harnessId}
          selected={selectedModel}
          loadout={loadout}
          modelOptions={harness?.capabilities.modelOptions}
          allowCustomModel={harness?.capabilities.allowCustomModel}
          onChange={setSelectedModel}
        />

        <div className="space-y-1.5 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[13px]">
            <span>Effort</span>
            <SettingsHint text="Passed using the selected harness's native reasoning-effort setting. Only values supported by that harness are shown." />
            <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">
              {agentEffortLabel(shownEffort, effortLabels)}
            </span>
          </div>
          <AgentEffortPicker
            value={values.agentEffort ?? settings?.agentEffort}
            levels={effortLevels}
            labels={effortLabels}
            onChange={(effort) => setValues((current) => ({ ...current, agentEffort: effort }))}
          />
        </div>

        <div className="space-y-1.5 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[13px]">
            <span>Access</span>
            <SettingsHint text="Workspace keeps the agent sandboxed to local edits. Full automation preserves Studio's deploy/install capability and grants unrestricted local command access." />
            <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">
              {values.agentAccess ?? settings?.agentAccess ?? 'full'}
            </span>
          </div>
          <AgentAccessPicker
            value={values.agentAccess ?? settings?.agentAccess}
            levels={accessLevels}
            onChange={(access) => setValues((current) => ({ ...current, agentAccess: access }))}
          />
        </div>

        <AgentSession domainId={domainId} harness={harness} />

        <AgentLoadout
          loadout={loadout}
          loading={loadoutFetching || refreshLoadout.isPending}
          errorMessage={
            loadoutError ? String((loadoutError as Error)?.message ?? loadoutError) : undefined
          }
          usage={usage}
          domainId={domainId}
          onRefresh={() => refreshLoadout.mutate(domainId!)}
        />
      </div>
    </div>
  )
}
