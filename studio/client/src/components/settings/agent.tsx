import type { StudioSettings } from '@shared/contracts/runtime'
import type { Dispatch, SetStateAction } from 'react'

import {
  AGENT_ACCESS_LEVELS,
  type AgentAccess,
  type HarnessPresence,
  type HarnessStatus,
} from '@shared/contracts/agent'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { HarnessLogo } from '@/components/harness-logo'
import { Button } from '@/components/ui/button'
import { brandTone } from '@/components/work-panel/chat-tone'
import { api, qk } from '@/lib/api'
import { useActiveChat, useActiveChatId } from '@/lib/chats'
import { labelOf, noAgentNotice } from '@/lib/harnesses'
import { useAgentSession, useLoadout, useUsage } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { SettingRow, SettingSelect, SettingsHeading, SettingsHint } from './controls'
import { AgentLoadout } from './loadout'

const ACCESS_OPTIONS: { value: AgentAccess; label: string }[] = [
  { value: 'workspace', label: 'Workspace' },
  { value: 'full', label: 'Full automation' },
]

/** The level a saved value maps to: itself when offered, else full automation, else the first. */
export function resolveAgentAccess(
  value: string | undefined,
  levels: readonly AgentAccess[],
): AgentAccess | undefined {
  if (levels.includes(value as AgentAccess)) return value as AgentAccess
  return levels.includes('full') ? 'full' : levels[0]
}

/**
 * One local agent, as this machine has it. Read-only on purpose: which agent a
 * conversation runs is decided where you talk to it, so all Settings owes you is
 * "is it installed, and what answered when Studio asked?".
 */
function HarnessPresenceRow({ presence }: { presence: HarnessPresence }) {
  // the agent CLI's own version: the build Studio pins, or what a local one reported
  const version = presence.cli?.version ?? presence.version
  const warned = presence.ok && !!presence.cli?.warning
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <HarnessLogo
        harness={presence.id}
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          presence.ok ? brandTone(presence.id).mark : 'text-muted-foreground/50',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px]">{presence.label}</span>
          <span
            className={cn(
              'ml-auto shrink-0 font-mono text-[11px]',
              !presence.ok ? 'text-destructive' : warned ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            {presence.ok ? (version ?? 'detected') : 'not detected'}
          </span>
          <span
            aria-hidden
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              !presence.ok ? 'bg-destructive' : warned ? 'bg-warning' : 'bg-success',
            )}
          />
        </div>
        <p
          className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground"
          title={presence.message}
        >
          {presence.message}
        </p>
      </div>
    </div>
  )
}

/**
 * Which agents this machine has — and nothing to change.
 *
 * The model a conversation runs, the agent behind it and how hard it thinks are
 * all decided in the composer, on the chat they apply to. What is left for
 * Settings is the one thing the composer cannot answer — whether an agent is
 * installed here at all.
 */
export function AgentSettings({ harness }: { harness?: HarnessStatus }) {
  const detected = harness?.harnesses ?? []
  // The star can name an agent this machine does not have — the setting is kept and
  // Studio runs one it can (see server/agent/harness/selection.ts).
  const stranded =
    harness?.source === 'fallback' && harness.preferred ? labelOf(harness, harness.preferred) : null
  const missing = noAgentNotice(harness)?.full

  return (
    <div>
      <SettingsHeading>Agent</SettingsHeading>
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

/** Manual conversation ownership for the chat the user is in, and only that one. */
function AgentSession({ harness }: { harness?: HarnessStatus }) {
  const chat = useActiveChat()
  const { data: session, isFetching } = useAgentSession(chat?.id)
  const queryClient = useQueryClient()
  const [sessionId, setSessionId] = useState('')
  // The id is only meaningful to the chat's OWN agent, which never changes.
  const chatHarness = chat?.harness ?? harness?.id

  useEffect(() => {
    if (!chatHarness || isFetching) {
      setSessionId('')
      return
    }
    setSessionId(session?.sessionId ?? '')
  }, [chatHarness, isFetching, session?.sessionId])

  const save = useMutation({
    mutationFn: (input: { harness: string; sessionId: string; chatId?: string }) =>
      api.setAgentSession(input.harness, input.sessionId, input.chatId),
    onSuccess: (saved, input) => {
      queryClient.setQueryData(qk.agentSession(input.chatId), saved)
      queryClient.invalidateQueries({ queryKey: qk.agent() })
      queryClient.invalidateQueries({ queryKey: qk.chats })
      toast.success(saved.sessionId ? 'Agent session changed' : 'Agent session cleared')
    },
    onError: (error) => toast.error(String(error)),
  })

  return (
    <div className="space-y-1.5 px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-[13px]">
        <span>Session ID</span>
        <SettingsHint text="This chat's resumable conversation id. Paste another to resume that conversation; clear it to start fresh on the next turn. Cannot be changed while its turn is running." />
        {session && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {session.sessionId
              ? `${session.turns} turn${session.turns === 1 ? '' : 's'}${chatHarness ? ` · ${chatHarness}` : ''}`
              : 'no active conversation'}
          </span>
        )}
      </span>
      <input
        value={sessionId}
        onChange={(event) => setSessionId(event.target.value)}
        placeholder="none — a fresh conversation starts next turn"
        spellCheck={false}
        className="w-full rounded-md border bg-card px-2 py-1 font-mono text-[12px] outline-none focus:border-primary"
      />
      <div className="flex justify-end">
        <Button
          size="xs"
          variant="link"
          disabled={
            !chatHarness ||
            isFetching ||
            sessionId.trim() === (session?.sessionId ?? '') ||
            save.isPending
          }
          onClick={() =>
            save.mutate({
              harness: chatHarness!,
              sessionId: sessionId.trim(),
              ...(chat ? { chatId: chat.id } : {}),
            })
          }
        >
          {save.isPending ? 'Applying…' : 'Apply session'}
        </Button>
      </div>
    </div>
  )
}

/** Power-user agent controls and runtime diagnostics shown only inside Details. */
export function AgentDetails({
  settings,
  harness,
  values,
  setValues,
}: {
  settings?: StudioSettings
  harness?: HarnessStatus
  values: Record<string, string>
  setValues: Dispatch<SetStateAction<Record<string, string>>>
}) {
  // Diagnostics describe the conversation the user is in, not the domain default.
  const chatId = useActiveChatId()
  const { data: loadout, isFetching: loadoutFetching, error: loadoutError } = useLoadout(chatId)
  const { data: usage } = useUsage()
  const queryClient = useQueryClient()
  const accessLevels = harness?.capabilities.accessLevels ?? [...AGENT_ACCESS_LEVELS]
  const access = resolveAgentAccess(values.agentAccess ?? settings?.agentAccess, accessLevels)

  const refreshLoadout = useMutation({
    mutationFn: () => api.loadout(true, chatId),
    onSuccess: (refreshed) => queryClient.setQueryData(qk.loadout(chatId), refreshed),
    onError: (error) => toast.error(String(error)),
  })

  return (
    <div>
      <SettingsHeading>Agent details</SettingsHeading>
      <div className="divide-y divide-border rounded-lg border bg-card">
        <SettingRow
          label="Access"
          description="Workspace sandboxes the agent to local edits; full automation also lets it run commands and deploy."
        >
          <SettingSelect
            aria-label="Agent access"
            value={access}
            options={ACCESS_OPTIONS.filter((option) => accessLevels.includes(option.value))}
            onValue={(agentAccess) => setValues((current) => ({ ...current, agentAccess }))}
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
