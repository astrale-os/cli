import {
  AGENT_EFFORT_LEVELS,
  type AgentEffort,
  type DomainUsage,
  type HarnessLoadout,
  type LoadoutSkill,
  type StudioSettings,
} from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, Copy, HelpCircle, Lock, RefreshCw } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { EnvEditor } from '@/components/env-editor'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { api, qk } from '@/lib/api'
import {
  useAgentSession,
  useAgentSystemPrompt,
  useHarness,
  useLoadout,
  useSettings,
  useSkillContent,
  useUsage,
} from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * SettingsDialog — the (subtly hidden) power-user overrides for this domain,
 * reached via ⌘K → "Settings" or the faint header gear. Persists to
 * `.domain-studio/settings.json`.
 *
 * The fields are a DECLARATIVE registry grouped into sections, rendered as
 * compact `label [?] … input` rows (description tucked behind the ?) so the
 * dialog stays dense and scannable as more knobs are lifted out of the code —
 * adding one is a single line in SECTIONS. The "Agent" section is special: the
 * harness (locked to Claude Code for now, with a live install probe) and the
 * session id live in agent state, not settings.json, so they round-trip through
 * their own endpoints but save with the same button.
 */
type FieldDef = {
  key: keyof StudioSettings
  label: string
  hint: string
  type: 'text' | 'number'
  placeholder?: string
}

const EFFORT_LABELS: Record<AgentEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-high',
  max: 'Max',
  ultracode: 'Ultracode',
}
const isAgentEffort = (value: string | undefined): value is AgentEffort =>
  !!value && (AGENT_EFFORT_LEVELS as readonly string[]).includes(value)

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Detection',
    fields: [
      {
        key: 'integrationsDir',
        label: 'Integrations folder',
        hint: 'Folder under the domain root scanned for integrations.',
        type: 'text',
        placeholder: 'integrations',
      },
    ],
  },
  {
    title: 'Performance',
    fields: [
      {
        key: 'introspectTimeoutMs',
        label: 'Schema extraction timeout',
        hint: 'How long the Bun introspector may run before it is killed (ms). Raise for very large domains.',
        type: 'number',
        placeholder: '20000',
      },
      {
        key: 'instancePollMs',
        label: 'Instance status poll',
        hint: 'How often the deploy / instance status refreshes (ms). Raise to make fewer CLI calls.',
        type: 'number',
        placeholder: '30000',
      },
      {
        key: 'updatesPollMs',
        label: 'Updates check interval',
        hint: 'How often the studio re-checks for stale schema / available updates (ms).',
        type: 'number',
        placeholder: '600000',
      },
      {
        key: 'viewProbeTimeoutMs',
        label: 'View URL probe timeout',
        hint: 'How long to wait when resolving a live view URL from the instance (ms).',
        type: 'number',
        placeholder: '8000',
      },
    ],
  },
]

function Hint({ text }: { text: string }) {
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label="What's this?"
          className="text-muted-foreground/40 transition-colors hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-auto max-w-xs text-[13px] leading-relaxed text-muted-foreground">
        {text}
      </HoverCardContent>
    </HoverCard>
  )
}

/** A compact label → value row for the Agent card. */
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
        {hint && <Hint text={hint} />}
      </span>
      <span className="ml-auto truncate font-mono text-[11px]">{value}</span>
    </div>
  )
}

function AgentEffortPicker({
  value,
  onChange,
}: {
  value?: string
  onChange: (value: AgentEffort) => void
}) {
  const current = isAgentEffort(value) ? value : 'high'
  return (
    <div
      className="grid grid-cols-3 gap-1 rounded-md bg-muted/45 p-1 sm:grid-cols-6"
      role="radiogroup"
      aria-label="Agent effort"
    >
      {AGENT_EFFORT_LEVELS.map((effort) => (
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

/** The skills surfaced up-front; the rest hide behind "show all". */
const FEATURED = ['astrale-cli', 'astrale-domain', 'agent-browser']

/** One skill row — click to reveal its SKILL.md (fetched on demand). */
function SkillRow({
  s,
  domainId,
  expanded,
  onToggle,
}: {
  s: LoadoutSkill
  domainId?: string
  expanded: boolean
  onToggle: () => void
}) {
  const { data: content, isLoading } = useSkillContent(
    expanded ? domainId : undefined,
    expanded ? s.command : undefined,
  )
  const tag = s.source === 'plugin' ? (s.plugin ?? 'plugin') : s.source
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40"
        title={s.description ?? s.command}
      >
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            s.loaded ? 'bg-emerald-500' : 'bg-amber-500',
          )}
          title={
            s.loaded
              ? 'loaded by Claude Code here'
              : 'on disk but NOT loaded by Claude Code in this folder'
          }
        />
        <span className="truncate font-mono text-[12px]">{s.command}</span>
        <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground/80">
          {tag}
        </span>
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && (
        <div className="border-t bg-background/60 px-2.5 py-2">
          {isLoading ? (
            <p className="text-[11px] text-muted-foreground/60">Loading…</p>
          ) : content ? (
            <>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-[11px] leading-relaxed">
                {content.content}
              </pre>
              <p
                className="mt-1 truncate font-mono text-[10px] text-muted-foreground/50"
                title={content.path}
              >
                {content.path}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground/60">
              Couldn't read this skill's SKILL.md.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * How to install each featured skill when it is missing — so the "not installed"
 * badge GUIDES instead of dead-ending. The two astrale skills ship together from
 * the public cli repo; agent-browser is a third-party tool (the binary `astrale
 * browser` drives) plus its skill. Mirrors the CLI's setup steps — keep in sync
 * with cli/src/setup/steps/agent-browser.ts and cli/src/lib/skills.ts.
 */
const SKILL_INSTALL: Record<string, string[]> = {
  'astrale-cli': ['npx skills add astrale-os/cli -g'],
  'astrale-domain': ['npx skills add astrale-os/cli -g'],
  'agent-browser': [
    'npm install -g agent-browser && agent-browser install',
    'npx skills add vercel-labs/agent-browser -g',
  ],
}

/** A copyable command line — click to put it on the clipboard. */
function CopyCommand({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(cmd)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          toast.error('Copy failed — select the command and copy it manually.')
        }
      }}
      className="group flex w-full items-center gap-2 rounded bg-muted/40 px-2 py-1 text-left font-mono text-[11px] transition-colors hover:bg-muted"
      title="Copy to clipboard"
    >
      <span className="truncate">{cmd}</span>
      {copied ? (
        <Check className="ml-auto h-3 w-3 shrink-0 text-emerald-500" />
      ) : (
        <Copy className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
      )}
    </button>
  )
}

/** A featured skill that is absent on disk — click to reveal how to install it
 *  (the gap Studio used to flag without telling you how to fix). */
function MissingSkillRow({ command }: { command: string }) {
  const [open, setOpen] = useState(false)
  const cmds = SKILL_INSTALL[command]
  return (
    <div>
      <button
        type="button"
        onClick={() => cmds && setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40"
        title="not installed on disk in this workspace — click to see how"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" title="not installed" />
        <span className="truncate font-mono text-[12px] text-muted-foreground/60 line-through">
          {command}
        </span>
        <span className="ml-auto shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
          not installed
        </span>
        {cmds && (
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform',
              open && 'rotate-90',
            )}
          />
        )}
      </button>
      {open && cmds && (
        <div className="space-y-1.5 border-t bg-background/60 px-2.5 py-2">
          <p className="text-[11px] text-muted-foreground/70">Run, then hit re-probe above:</p>
          {cmds.map((cmd) => (
            <CopyCommand key={cmd} cmd={cmd} />
          ))}
          <p className="text-[10px] text-muted-foreground/50">
            Or run <span className="font-mono">astrale setup</span> to equip everything at once.
          </p>
        </div>
      )}
    </div>
  )
}

const fmtTokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : String(n)

function SystemPromptReveal({ domainId }: { domainId?: string }) {
  const [open, setOpen] = useState(false)
  const { data, isLoading, error } = useAgentSystemPrompt(open ? domainId : undefined)
  return (
    <div className="space-y-2 px-3 py-2.5 text-[12px]">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-[13px]">
          <span>Injected system prompt</span>
          <Hint text="The exact appendix passed to the local harness with --append-system-prompt. It is hidden by default because it is long and mostly protocol." />
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div>
          {isLoading ? (
            <p className="text-[11px] text-muted-foreground/70">Loading…</p>
          ) : error ? (
            <p className="text-[11px] text-destructive">
              {String((error as Error)?.message ?? error)}
            </p>
          ) : (
            <>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
                {data?.systemPrompt ?? ''}
              </pre>
              <p className="mt-1 text-[10px] text-muted-foreground/50">
                bridge tools: {data?.bridge ? 'enabled' : 'disabled'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** The harness loadout (skills + tools) + this-domain usage — folded INTO the
 *  Agent card as divide-y sibling rows so the dialog stays compact. */
function AgentExtras({
  loadout,
  loading,
  errorMsg,
  usage,
  domainId,
  onRefresh,
}: {
  loadout?: HarnessLoadout
  loading: boolean
  errorMsg?: string
  usage?: DomainUsage
  domainId?: string
  onRefresh: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const toggle = (cmd: string) => setExpanded((c) => (c === cmd ? null : cmd))

  const skills = loadout?.skills ?? []
  const byCmd = new Map(skills.map((s) => [s.command, s]))
  const featuredSet = new Set(FEATURED)
  const rest = skills
    .filter((s) => !featuredSet.has(s.command))
    .sort((a, b) => Number(a.loaded) - Number(b.loaded) || a.command.localeCompare(b.command))
  const loadedCount = skills.filter((s) => s.loaded).length

  return (
    <>
      {/* Loaded by the harness */}
      <div className="space-y-2 px-3 py-2.5 text-[12px]">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span>Loaded by the harness</span>
          <Hint text="What the local Claude Code actually loaded for THIS domain's folder — probed live from its session-init event (the reliable signal). A skill on disk but not active here shows amber." />
          <button
            type="button"
            onClick={onRefresh}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
            title="Re-probe"
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} /> re-probe
          </button>
        </div>
        {errorMsg ? (
          <p className="text-[11px] leading-relaxed text-destructive">
            {errorMsg.includes('404')
              ? 'The studio server predates this feature (no /agent/loadout route). Restart it — bun server/index.ts … — to pick it up.'
              : errorMsg}
          </p>
        ) : loading && !loadout ? (
          <p className="text-[11px] text-muted-foreground/70">Probing the harness…</p>
        ) : !loadout?.ok ? (
          <p className="text-[11px] text-muted-foreground/70">
            {loadout?.detail ?? 'Loadout unavailable.'}
          </p>
        ) : (
          <div className="space-y-2">
            <MetaRow label="Model" value={loadout.model ?? '—'} />
            <MetaRow label="Tools" value={loadout.tools.length} title={loadout.tools.join(', ')} />
            <MetaRow
              label="Subagents"
              value={loadout.agents.length}
              title={loadout.agents.join(', ')}
            />

            {/* Skills — featured up front, the rest behind "show all". Click one to read it. */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span>Skills</span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground/80">
                  {loadedCount} loaded / {skills.length}
                </span>
              </div>
              <div
                className={cn(
                  'divide-y divide-border/50 overflow-hidden rounded-md border bg-background/40',
                  showAll && 'max-h-64 overflow-y-auto',
                )}
              >
                {FEATURED.map((command) => {
                  const s = byCmd.get(command)
                  return s ? (
                    <SkillRow
                      key={command}
                      s={s}
                      domainId={domainId}
                      expanded={expanded === command}
                      onToggle={() => toggle(command)}
                    />
                  ) : (
                    <MissingSkillRow key={command} command={command} />
                  )
                })}
                {showAll &&
                  rest.map((s) => (
                    <SkillRow
                      key={s.command}
                      s={s}
                      domainId={domainId}
                      expanded={expanded === s.command}
                      onToggle={() => toggle(s.command)}
                    />
                  ))}
              </div>
              {rest.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="px-1 text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
                >
                  {showAll ? 'Hide others' : `Show all (${rest.length} more)`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Usage — also folded into Agent to stay compact */}
      <div className="space-y-1.5 px-3 py-2.5 text-[12px]">
        <span className="flex items-center gap-1.5 text-[13px]">
          <span>Usage</span>
          <Hint text="This studio's agent turns on THIS domain (succeeded or not). Machine-wide totals live in ~/.claude and are out of scope here." />
          <span className="ml-auto text-[11px] text-muted-foreground/60">this domain</span>
        </span>
        <MetaRow label="Turns" value={usage?.runs ?? 0} />
        <MetaRow label="Tokens" value={fmtTokens(usage?.tokens ?? 0)} />
        <MetaRow label="Cost" value={`$${(usage?.costUsd ?? 0).toFixed(4)}`} />
        {usage?.lastTokens != null && (
          <MetaRow
            label="Last turn"
            value={`${fmtTokens(usage.lastTokens)} tok · $${(usage.lastCostUsd ?? 0).toFixed(4)}`}
          />
        )}
      </div>
    </>
  )
}

export function SettingsDialog() {
  const open = useUI((s) => s.settingsOpen)
  const setOpen = useUI((s) => s.setSettingsOpen)
  const domainId = useUI((s) => s.domainId)
  const { data } = useSettings(open ? domainId : undefined)
  const { data: session } = useAgentSession(open ? domainId : undefined)
  const { data: harness } = useHarness(open ? domainId : undefined)
  const {
    data: loadout,
    isFetching: loadoutFetching,
    error: loadoutError,
  } = useLoadout(open ? domainId : undefined)
  const { data: usage } = useUsage(open ? domainId : undefined)
  const qc = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>({})
  const [sessionId, setSessionId] = useState('')

  useEffect(() => {
    if (data) setValues(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])))
  }, [data])
  useEffect(() => {
    if (session) setSessionId(session.sessionId ?? '')
  }, [session])

  const save = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {}
      for (const sec of SECTIONS)
        for (const f of sec.fields) {
          const raw = values[f.key] ?? ''
          patch[f.key] =
            f.type === 'number'
              ? Number(raw) || (data?.[f.key] as number)
              : raw.trim() || (data?.[f.key] as string)
        }
      const effort = isAgentEffort(values.agentEffort) ? values.agentEffort : data?.agentEffort
      if (effort) patch.agentEffort = effort
      await api.updateSettings(domainId!, patch as Partial<StudioSettings>)
      // The session id is agent state, not settings — only touch it if it changed.
      if (sessionId.trim() !== (session?.sessionId ?? ''))
        await api.setAgentSession(domainId!, sessionId.trim())
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.settings(domainId!) })
      qc.invalidateQueries({ queryKey: qk.anatomy(domainId!) }) // integrations folder drives detection
      qc.invalidateQueries({ queryKey: qk.agentSession(domainId!) })
      qc.invalidateQueries({ queryKey: qk.agent(domainId!) }) // conversation summary in the agent drawer
      toast.success('Settings saved')
      setOpen(false)
    },
    onError: (e) => toast.error(String(e)),
  })

  const harnessOptions = harness?.options ?? [{ id: 'claude', label: 'Claude Code (local)' }]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Power-user overrides for this domain — stored in .domain-studio/settings.json.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 max-h-[60vh] space-y-5 overflow-y-auto px-1">
          {/* Agent — first: harness (locked) + session id (live agent state) + the loadout/usage readout */}
          <div>
            <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Agent
            </div>
            <div className="divide-y divide-border/50 rounded-lg border bg-card/40">
              {/* Harness — locked to Claude Code for now, with a live install probe */}
              <div className="space-y-2 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
                    <span className="truncate">Harness</span>
                    <Hint text="Which local AI agent does the edits. Only Claude Code is supported for now; more harnesses (Codex, …) later." />
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Lock className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                    <select
                      disabled
                      value={harness?.id ?? 'claude'}
                      className="w-40 shrink-0 cursor-not-allowed rounded-md border bg-background px-2 py-1 text-[13px] text-muted-foreground outline-none"
                    >
                      {harnessOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
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
                </div>
              </div>

              {/* Effort */}
              <div className="space-y-1.5 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[13px]">
                  <span>Effort</span>
                  <Hint text="Passed to Claude Code as --effort. Values come from the local claude --help output." />
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">
                    {values.agentEffort ?? data?.agentEffort ?? 'high'}
                  </span>
                </div>
                <AgentEffortPicker
                  value={values.agentEffort ?? data?.agentEffort}
                  onChange={(effort) => setValues((v) => ({ ...v, agentEffort: effort }))}
                />
              </div>

              {/* Session ID */}
              <div className="space-y-1.5 px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-[13px]">
                  <span>Session ID</span>
                  <Hint text="The agent's resumable conversation id. Paste another to resume that conversation; clear it to start fresh on the next turn. Cannot be changed while a turn is running." />
                  {session && (
                    <span className="ml-auto text-[11px] text-muted-foreground/60">
                      {session.sessionId
                        ? `${session.turns} turn${session.turns === 1 ? '' : 's'}${session.harness ? ` · ${session.harness}` : ''}`
                        : 'no active conversation'}
                    </span>
                  )}
                </span>
                <input
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  placeholder="(none — a fresh conversation starts next turn)"
                  spellCheck={false}
                  className="w-full rounded-md border bg-background px-2 py-1 font-mono text-[12px] outline-none focus:border-primary"
                />
              </div>

              {/* Read-only: what the harness ACTUALLY loaded for this domain + its spend — nested in Agent to stay compact */}
              <SystemPromptReveal domainId={domainId} />
              <AgentExtras
                loadout={loadout}
                loading={loadoutFetching}
                errorMsg={
                  loadoutError
                    ? String((loadoutError as Error)?.message ?? loadoutError)
                    : undefined
                }
                usage={usage}
                domainId={domainId}
                onRefresh={() => qc.invalidateQueries({ queryKey: qk.loadout(domainId!) })}
              />
            </div>
          </div>

          <EnvEditor domainId={domainId} />

          {SECTIONS.map((sec) => (
            <div key={sec.title}>
              <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {sec.title}
              </div>
              <div className="divide-y divide-border/50 rounded-lg border bg-card/40">
                {sec.fields.map((f) => (
                  <div key={f.key} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
                      <span className="truncate">{f.label}</span>
                      <Hint text={f.hint} />
                    </span>
                    <input
                      type={f.type}
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-32 shrink-0 rounded-md border bg-background px-2 py-1 text-right font-mono text-[13px] outline-none focus:border-primary"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!domainId || !data || save.isPending}
            onClick={() => save.mutate()}
            className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
