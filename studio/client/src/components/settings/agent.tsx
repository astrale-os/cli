import type { Dispatch, SetStateAction } from 'react'

import { AGENT_ACCESS_LEVELS, type HarnessStatus, type StudioSettings } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { useActiveChatId } from '@/lib/chats'
import { useLoadout, useUsage } from '@/lib/hooks'

import { AgentAccessPicker } from './agent-access'
import { AgentSession } from './agent-session'
import { HarnessPresenceRow } from './harness-presence'
import { AgentLoadout } from './loadout'
import { SettingRow } from './row'

export interface AgentSettingsProps {
  harness?: HarnessStatus
}

/**
 * Which agents this machine has — and nothing to change.
 *
 * The model a conversation runs, the agent behind it and how hard it thinks are
 * all decided in the composer, on the chat they apply to: picking a model IS
 * picking an agent, and there is one starred model that new chats open on. What
 * is left for Settings is the one thing the composer cannot answer — whether an
 * agent is installed here at all.
 */
export function AgentSettings({ harness }: AgentSettingsProps) {
  const detected = harness?.harnesses ?? []

  return (
    <div>
      <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Agent
      </div>
      <div className="divide-y divide-border rounded-lg border bg-card">
        {detected.length === 0 ? (
          <p className="px-3 py-2.5 text-[12px] text-muted-foreground">Looking for local agents…</p>
        ) : (
          detected.map((presence) => <HarnessPresenceRow key={presence.id} presence={presence} />)
        )}
      </div>
      <p className="mt-1.5 px-1 text-[11px] leading-snug text-muted-foreground">
        {harness?.locked ? (
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3 shrink-0" />
            Locked to {harness.label} by --harness. New chats open on it.
          </span>
        ) : (
          <>New chats open on the model you starred in the composer — star another to move it.</>
        )}
      </p>
    </div>
  )
}

export interface AgentDetailsProps {
  domainId?: string
  settings?: StudioSettings
  harness?: HarnessStatus
  values: Record<string, string>
  setValues: Dispatch<SetStateAction<Record<string, string>>>
}

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
