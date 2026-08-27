/**
 * Shared agent and harness protocol.
 *
 * These shapes are harness-neutral and describe Studio's recorded conversation,
 * capability, loadout, usage, and gateway configuration surfaces.
 */

import type { MergeResult } from './workspace'

/** Kinds of activity the studio surfaces while a local agent runs a turn. */
export type AgentEventKind = 'status' | 'thinking' | 'message' | 'tool' | 'reply' | 'error'

export interface AgentEvent {
  id: string
  ts: string
  kind: AgentEventKind
  text: string
  /** for kind:'tool' — the tool name (Edit/Write/Bash/Read…) */
  tool?: string
  /** for kind:'tool' — a compact target (file path, command, pattern) */
  target?: string
  /** for kind:'reply' — the comment id the reply landed on */
  commentId?: string
}

export const AGENT_EFFORT_LEVELS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultracode',
] as const
export type AgentEffort = (typeof AGENT_EFFORT_LEVELS)[number]
export const AGENT_ACCESS_LEVELS = ['workspace', 'full'] as const
export type AgentAccess = (typeof AGENT_ACCESS_LEVELS)[number]

export interface AgentPromptSnapshot {
  createdAt: string
  /** appended to the harness default system prompt */
  systemPrompt: string
  /** piped to the harness on stdin */
  turnPrompt: string
  /** true when this turn started a new harness conversation */
  firstTurn: boolean
  /** true when this turn used a prior harness session id */
  resumed: boolean
  sessionId?: string
  /** Explicit Studio model override used for this turn; absent means harness-native default. */
  model?: string
  /** Harness-native reasoning effort used for this turn. */
  effort?: AgentEffort
  /** Filesystem/network authority granted to the harness for this turn. */
  access?: AgentAccess
  /** generated MCP bridge tools exposed to the harness for live write-back */
  mcpTools: string[]
}

export interface AgentSystemPromptInfo {
  bridge: boolean
  systemPrompt: string
}

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  /** the studio process died mid-turn (restart/crash) — the spawned agent went with
   *  it, but the CONVERSATION is preserved, so the next submit resumes it. */
  | 'interrupted'

/** One agent turn for a domain: the live transcript + outcome. */
export interface AgentRun {
  id: string
  domainId: string
  harness: string
  status: AgentRunStatus
  createdAt: string
  finishedAt?: string
  /** the harness session id (so the next turn resumes the same conversation) */
  sessionId?: string
  /** true ⇒ this turn resumed an existing conversation (vs. started a new one) */
  resumed?: boolean
  /** short human label of what this turn was asked to do */
  summary: string
  /** the instruction as typed, verbatim — what the chat shows as your message.
   *  Absent when the turn was started from open threads rather than a message. */
  instruction?: string
  /** comment ids this turn was started to answer */
  targetCommentIds: string[]
  events: AgentEvent[]
  costUsd?: number
  numTurns?: number
  /** total token usage reported by the harness for this turn */
  tokens?: number
  error?: string
  /** how many threads the agent answered live via the bridge tools this turn */
  liveReplies?: number
  /** result of merging the agent's final machine-state reply block, if any */
  merge?: MergeResult
  /** exact prompt inputs sent to the harness for this turn */
  prompt?: AgentPromptSnapshot
}

/** The ongoing, resumable conversation for a domain and selected harness.
 *  Survives studio restarts (persisted on disk). */
export interface ConversationInfo {
  /** a resumable session exists → the next submit continues it (vs. starting fresh) */
  active: boolean
  /** successful turns recorded in the current conversation */
  turns: number
  /** which harness the conversation belongs to (resume only applies within it) */
  harness?: string
}

/** The agent's raw resumable session id, surfaced for manual view/edit in Settings. */
export interface AgentSessionInfo {
  sessionId: string | null
  turns: number
  harness?: string
}

export interface HarnessCapabilities {
  effortLevels: readonly AgentEffort[]
  accessLevels: readonly AgentAccess[]
  /** Stable aliases advertised even when the harness has no catalog API. */
  modelOptions?: readonly HarnessModelOption[]
  ask: boolean
  loadout: boolean
  /** Custom model-gateway wire contract this harness can consume in Studio. */
  gateway: 'anthropic' | 'responses' | 'none'
}

/** Whether the selected agent harness is installed, invokable, and configurable. */
export interface HarnessStatus {
  id: string
  label: string
  /** the binary/command probed (e.g. 'claude') */
  bin: string
  ok: boolean
  version?: string
  /** human message — install / PATH guidance when not ok */
  message: string
  /** known harnesses for the selector (locked to one for now) */
  options: { id: string; label: string }[]
  /** an environment/CLI override owns the selection, so the GUI cannot change it */
  locked: boolean
  source: 'environment' | 'domain' | 'default'
  capabilities: HarnessCapabilities
}

/** One MCP server the harness loaded, with its live connection status. */
export interface McpServerInfo {
  name: string
  /** harness-reported status: 'connected' | 'needs-auth' | 'failed' | 'pending' | … */
  status: string
}

/** One skill, reconciled between what is installed on disk and what the harness
 *  actually LOADED for this domain's cwd. */
export interface LoadoutSkill {
  /** the slash-command the harness invokes it by — e.g. 'astrale-domain' or 'vercel:nextjs' */
  command: string
  /** display name from SKILL.md frontmatter (falls back to `command`) */
  name: string
  description?: string
  /** where it lives on disk */
  source: 'project' | 'user' | 'plugin'
  /** the providing plugin, when source==='plugin' */
  plugin?: string
  /** present in the harness's loaded slash-commands for this cwd */
  loaded: boolean
  /** absolute path to the skill's SKILL.md (so the UI can show its content) */
  path?: string
}

/** What the harness actually loaded for a domain's cwd. */
export interface HarnessLoadout {
  /** the probe ran and returned an init event */
  ok: boolean
  /** reason when !ok (binary missing / probe timed out / no init event) */
  detail?: string
  /** Model the harness resolves before Studio applies its optional override. */
  nativeModel?: string
  model?: string
  /** Where the effective model came from. */
  modelSource?: 'studio' | 'config' | 'default' | 'runtime'
  /** Models the harness currently advertises for easy selection. */
  models?: HarnessModelOption[]
  permissionMode?: string
  /** how the harness is authed: 'none' | 'ANTHROPIC_API_KEY' | … */
  apiKeySource?: string
  /** the cwd the harness was probed in (the domain root) */
  cwd?: string
  /** built-in tool names loaded (Read, Edit, Bash, …) */
  tools: string[]
  mcpServers: McpServerInfo[]
  skills: LoadoutSkill[]
  /** subagent types available to the harness (incl. plugin-provided) */
  agents: string[]
  /** count of loaded slash-commands that are built-in/harness commands, not skills */
  builtinCommandCount: number
  /** epoch ms when probed */
  probedAt: number
  /** Claude exposes a live init event; Codex exposes configured/installed state. */
  source?: 'runtime' | 'configured'
}

export interface HarnessModelOption {
  /** Stable model slug passed to the harness, e.g. `gpt-5.6-sol`. */
  id: string
  /** Human-friendly catalog label. */
  label: string
  description?: string
  /** The harness catalog's built-in default when no config layer overrides it. */
  isDefault?: boolean
}

/** Domain-attributable agent spend — accumulated from this studio's own runs on
 *  this domain (NOT machine-wide). Stored at `.domain-studio/usage.json`. */
export interface DomainUsage {
  /** runs that reported usage (succeeded or not — a failed turn still costs) */
  runs: number
  /** cumulative tokens (input + output + cache) across those runs */
  tokens: number
  /** cumulative USD across those runs */
  costUsd: number
  lastRunAt?: string
  lastTokens?: number
  lastCostUsd?: number
}

/** Snapshot returned by GET /agent — drives the activity drawer. */
export interface AgentRunSnapshot {
  harness: string
  available: boolean
  /** the active or most-recent run for this domain (null if none yet) */
  run: AgentRun | null
  /** the resumable conversation behind the runs (turns, whether one is live) */
  conversation: ConversationInfo
}

/** How the harness gets its bearer token for a custom model gateway. */
export type HarnessGatewayAuth =
  | { mode: 'mint'; instance?: string }
  | { mode: 'token'; token: string }
  | { mode: 'host' }

export interface HarnessGatewayConfig {
  /** master switch — off ⇒ the harness uses its own default auth */
  enabled: boolean
  /** ANTHROPIC_BASE_URL used by the spawned harness child only. */
  baseUrl: string
  /** ANTHROPIC_MODEL label; the gateway may pin the real model by URL. */
  model?: string
  /** how the bearer token is obtained */
  auth: HarnessGatewayAuth
}

/** The layered harness-gateway config for a domain. */
export interface HarnessGatewayState {
  /** per-domain override (`.domain-studio/harness-gateway.json`); null ⇒ inherits global */
  local: HarnessGatewayConfig | null
  /** studio-wide default — applies to every domain that has no local override */
  global: HarnessGatewayConfig | null
  /** the config that actually takes effect, else null */
  effective: HarnessGatewayConfig | null
  /** which layer `effective` came from */
  source: 'domain' | 'global' | 'none'
}
