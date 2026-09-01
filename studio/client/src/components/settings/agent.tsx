import type { Dispatch, SetStateAction } from 'react'

import { updateAgentModel } from '@shared/agent-models'
import {
  AGENT_ACCESS_LEVELS,
  AGENT_EFFORT_LEVELS,
  type HarnessStatus,
  type StudioSettings,
} from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'

import { HarnessLogo } from '@/components/harness-logo'
import { brandTone } from '@/components/work-panel/chat-tone'
import { api, qk } from '@/lib/api'
import { useActiveChatId } from '@/lib/chats'
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

/** Harness, model, and effort settings that stay visible in the main Settings view. */
export function AgentSettings({
  domainId,
  settings,
  harness,
  values,
  setValues,
  agentModels,
  setAgentModels,
}: AgentSettingsProps) {
  const { data: loadout } = useLoadout(domainId)
  const queryClient = useQueryClient()
  const effortLevels = harness?.capabilities.effortLevels ?? [...AGENT_EFFORT_LEVELS]
  // Choosing another agent does not convert the open chat — it cannot, the
  // session belongs to one harness. The server forks a tab instead, and says so.
  const selectHarness = useMutation({
    mutationFn: (input: { domainId: string; harness: string }) =>
      api.selectHarness(input.domainId, input.harness),
    onSuccess: (result, input) => {
      queryClient.setQueryData(qk.harness(input.domainId), result.harness)
      queryClient.invalidateQueries({ queryKey: qk.harness(input.domainId) })
      queryClient.invalidateQueries({ queryKey: qk.agentSession(input.domainId) })
      queryClient.invalidateQueries({ queryKey: qk.agent(input.domainId) })
      queryClient.invalidateQueries({ queryKey: qk.loadout(input.domainId) })
      queryClient.invalidateQueries({ queryKey: qk.chats(input.domainId) })
      toast.success(
        result.chat
          ? `New ${result.harness.label} chat — your previous conversation stays open, summarized for this one`
          : `Using ${result.harness.label}`,
      )
    },
    onError: (error) => toast.error(String(error)),
  })

  const harnessOptions = harness?.options ?? [{ id: 'claude', label: 'Claude Code' }]
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
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">Default agent</div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                Picking another one opens a new chat with it — a conversation cannot change agent,
                so this one stays as it is.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {harness?.locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
              {/* a native <select> cannot carry a mark inside its options — this one
                  sits beside it, naming the agent the same way the tab strip does */}
              <HarnessLogo harness={harnessId} className={brandTone(harnessId).mark} />
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

        <AgentModel selected={selectedModel} loadout={loadout} onChange={setSelectedModel} />

        <SettingRow label="Reasoning effort">
          <AgentEffortPicker
            value={values.agentEffort ?? settings?.agentEffort}
            levels={effortLevels}
            onChange={(effort) => setValues((current) => ({ ...current, agentEffort: effort }))}
          />
        </SettingRow>
      </div>
    </div>
  )
}

export type AgentDetailsProps = Pick<
  AgentSettingsProps,
  'domainId' | 'settings' | 'harness' | 'values' | 'setValues'
>

/** Power-user agent controls and runtime diagnostics shown only inside Details. */
export function AgentDetails({
  domainId,
  settings,
  harness,
  values,
  setValues,
}: AgentDetailsProps) {
  // Diagnostics describe the conversation the user is in, not the domain default.
  const chatId = useActiveChatId(domainId)
  const {
    data: loadout,
    isFetching: loadoutFetching,
    error: loadoutError,
  } = useLoadout(domainId, chatId)
  const { data: usage } = useUsage(domainId)
  const queryClient = useQueryClient()
  const accessLevels = harness?.capabilities.accessLevels ?? [...AGENT_ACCESS_LEVELS]

  const refreshLoadout = useMutation({
    mutationFn: (id: string) => api.loadout(id, true, chatId),
    onSuccess: (refreshed, id) => queryClient.setQueryData(qk.loadout(id, chatId), refreshed),
    onError: (error) => toast.error(String(error)),
  })

  return (
    <div>
      <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Agent details
      </div>
      <div className="divide-y divide-border rounded-lg border bg-card">
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
