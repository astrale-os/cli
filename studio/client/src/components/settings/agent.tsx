import type { Dispatch, SetStateAction } from 'react'

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
import { AgentAccessPicker, AgentEffortPicker } from './agent-pickers'
import { AgentSession } from './agent-session'
import { AgentLoadout } from './loadout'
import { SettingRow, SettingSelect } from './row'

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
      <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Agent
      </div>
      <div className="divide-y divide-border rounded-lg border bg-card">
        <div className="space-y-2 px-3 py-2.5">
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-[13px]">Harness</span>
            <div className="flex shrink-0 items-center gap-1.5">
              {harness?.locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <SettingSelect
                disabled={!domainId || !harness || harness.locked || selectHarness.isPending}
                value={harness?.id ?? 'claude'}
                onChange={(event) =>
                  selectHarness.mutate({ domainId: domainId!, harness: event.target.value })
                }
              >
                {harnessOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </SettingSelect>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                !harness ? 'bg-muted-foreground/40' : harness.ok ? 'bg-success' : 'bg-destructive',
              )}
            />
            <span
              className={cn(
                'truncate',
                harness && !harness.ok ? 'font-medium text-destructive' : 'text-muted-foreground',
              )}
            >
              {harness ? harness.message : 'Checking…'}
            </span>
            {harness?.locked && (
              <span className="ml-auto shrink-0 text-muted-foreground">locked by --harness</span>
            )}
          </div>
        </div>

        <AgentModel
          selected={selectedModel}
          loadout={loadout}
          modelOptions={harness?.capabilities.modelOptions}
          onChange={setSelectedModel}
        />

        <SettingRow label="Reasoning effort">
          <AgentEffortPicker
            value={values.agentEffort ?? settings?.agentEffort}
            levels={effortLevels}
            onChange={(effort) => setValues((current) => ({ ...current, agentEffort: effort }))}
          />
        </SettingRow>

        <SettingRow
          label="Access"
          description="Workspace sandboxes the agent to local edits; full automation also lets it run commands and deploy."
        >
          <AgentAccessPicker
            value={values.agentAccess ?? settings?.agentAccess}
            levels={accessLevels}
            onChange={(access) => setValues((current) => ({ ...current, agentAccess: access }))}
          />
        </SettingRow>

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
