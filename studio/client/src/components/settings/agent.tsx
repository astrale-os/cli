import type { Dispatch, SetStateAction } from 'react'

import { AGENT_ACCESS_LEVELS, type HarnessStatus, type StudioSettings } from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { useActiveChatId } from '@/lib/chats'
import { labelOf, noAgentNotice } from '@/lib/harnesses'
import { useLoadout, useUsage } from '@/lib/hooks'
import { cn } from '@/lib/utils'

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
  // The star can name an agent this machine does not have — the setting is kept and
  // Studio runs one it can (see server/agent/harness/selection.ts). This panel is
  // where that is not a surprise: it is the list of what is installed.
  const stranded =
    harness?.source === 'fallback' && harness.preferred ? labelOf(harness, harness.preferred) : null
  const missing = noAgentNotice(harness)?.full

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
      <p
        className={cn(
          'mt-1.5 px-1 text-[11px] leading-snug',
          missing ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {missing ? (
          missing
        ) : harness?.locked ? (
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3 shrink-0" />
            Locked to {harness.label} by --harness. New chats open on it.
          </span>
        ) : stranded ? (
          <>
            Your starred model is {stranded}&apos;s, and {stranded} is not installed here — new
            chats open on {harness?.label} until it is back. The star is kept, not replaced.
          </>
        ) : (
          <>New chats open on the model you starred in the composer — star another to move it.</>
        )}
      </p>
    </div>
  )
}

export interface AgentDetailsProps {
  settings?: StudioSettings
  harness?: HarnessStatus
  values: Record<string, string>
  setValues: Dispatch<SetStateAction<Record<string, string>>>
}

/** Power-user agent controls and runtime diagnostics shown only inside Details. */
export function AgentDetails({ settings, harness, values, setValues }: AgentDetailsProps) {
  // Diagnostics describe the conversation the user is in, not the domain default.
  const chatId = useActiveChatId()
  const { data: loadout, isFetching: loadoutFetching, error: loadoutError } = useLoadout(chatId)
  const { data: usage } = useUsage()
  const queryClient = useQueryClient()
  const accessLevels = harness?.capabilities.accessLevels ?? [...AGENT_ACCESS_LEVELS]

  const refreshLoadout = useMutation({
    mutationFn: () => api.loadout(true, chatId),
    onSuccess: (refreshed) => queryClient.setQueryData(qk.loadout(chatId), refreshed),
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

        <AgentSession harness={harness} />

        <AgentLoadout
          loadout={loadout}
          loading={loadoutFetching || refreshLoadout.isPending}
          errorMessage={
            loadoutError ? String((loadoutError as Error)?.message ?? loadoutError) : undefined
          }
          usage={usage}
          onRefresh={() => refreshLoadout.mutate()}
        />
      </div>
    </div>
  )
}
