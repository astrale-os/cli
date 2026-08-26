import type { DomainUsage, HarnessLoadout } from '@shared/types'

import { RefreshCw } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { useAgentSystemPrompt } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { SettingsHint } from './hint'
import { SkillList } from './skills'

function MetaRow({
  label,
  value,
  title,
  hint,
}: {
  label: string
  value: ReactNode
  title?: string
  hint?: string
}) {
  return (
    <div className="flex items-center gap-3" title={title}>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {label}
        {hint && <SettingsHint text={hint} />}
      </span>
      <span className="ml-auto truncate font-mono text-[11px]">{value}</span>
    </div>
  )
}

const formatTokens = (tokens: number) =>
  tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : tokens >= 1_000
      ? `${(tokens / 1_000).toFixed(1)}k`
      : String(tokens)

function SystemPrompt({ domainId }: { domainId?: string }) {
  const [open, setOpen] = useState(false)
  const { data, isLoading, error } = useAgentSystemPrompt(open ? domainId : undefined)
  return (
    <div className="space-y-2 px-3 py-2.5 text-[12px]">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[13px]">
          <span>Injected system prompt</span>
          <SettingsHint text="The exact developer/system appendix passed to the selected local harness. It is hidden by default because it is long and mostly protocol." />
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div>
          {isLoading ? (
            <p className="text-[11px] text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-[11px] text-destructive">
              {String((error as Error)?.message ?? error)}
            </p>
          ) : (
            <>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
                {data?.systemPrompt ?? ''}
              </pre>
              <p className="mt-1 text-[10px] text-muted-foreground">
                bridge tools: {data?.bridge ? 'enabled' : 'disabled'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Read-only harness inventory, prompt, and domain-attributable usage. */
export function AgentLoadout({
  loadout,
  loading,
  errorMessage,
  usage,
  domainId,
  onRefresh,
}: {
  loadout?: HarnessLoadout
  loading: boolean
  errorMessage?: string
  usage?: DomainUsage
  domainId?: string
  onRefresh: () => void
}) {
  const sourceHint =
    loadout?.source === 'configured'
      ? 'What the selected harness has configured or installed for this folder. Codex discovers runtime tools when a turn starts.'
      : 'What the selected harness actually loaded for this folder, probed from its runtime initialization event.'

  return (
    <>
      <SystemPrompt domainId={domainId} />
      <div className="space-y-2 px-3 py-2.5 text-[12px]">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span>Loaded by the harness</span>
          <SettingsHint text={sourceHint} />
          <button
            type="button"
            disabled={loading}
            onClick={onRefresh}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            title="Re-probe"
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} /> re-probe
          </button>
        </div>
        {errorMessage ? (
          <p className="text-[11px] leading-relaxed text-destructive">
            {errorMessage.includes('404')
              ? 'The studio server predates this feature (no /agent/loadout route). Restart it — bun server/index.ts … — to pick it up.'
              : errorMessage}
          </p>
        ) : loading && !loadout ? (
          <p className="text-[11px] text-muted-foreground">Probing the harness…</p>
        ) : !loadout?.ok ? (
          <p className="text-[11px] text-muted-foreground">
            {loadout?.detail ?? 'Loadout unavailable.'}
          </p>
        ) : (
          <div className="space-y-2">
            <MetaRow label="Model" value={loadout.model ?? '—'} />
            <MetaRow
              label="Source"
              value={loadout.source === 'configured' ? 'configured' : 'runtime'}
              title={loadout.detail}
            />
            <MetaRow label="Tools" value={loadout.tools.length} title={loadout.tools.join(', ')} />
            <MetaRow
              label="Subagents"
              value={loadout.agents.length}
              title={loadout.agents.join(', ')}
            />
            <SkillList skills={loadout.skills} domainId={domainId} />
          </div>
        )}
      </div>
      <div className="space-y-1.5 px-3 py-2.5 text-[12px]">
        <span className="flex items-center gap-1.5 text-[13px]">
          <span>Usage</span>
          <SettingsHint text="This Studio's agent turns on this domain (succeeded or not). Machine-wide harness totals are out of scope." />
          <span className="ml-auto text-[11px] text-muted-foreground">this domain</span>
        </span>
        <MetaRow label="Turns" value={usage?.runs ?? 0} />
        <MetaRow label="Tokens" value={formatTokens(usage?.tokens ?? 0)} />
        <MetaRow label="Cost" value={`$${(usage?.costUsd ?? 0).toFixed(4)}`} />
        {usage?.lastTokens != null && (
          <MetaRow
            label="Last turn"
            value={`${formatTokens(usage.lastTokens)} tok · $${(usage.lastCostUsd ?? 0).toFixed(4)}`}
          />
        )}
      </div>
    </>
  )
}
