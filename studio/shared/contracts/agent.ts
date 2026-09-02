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

/**
 * Every reasoning rung Studio can name, ordered lightest to heaviest.
 *
 * The ladder a chat actually offers comes from ACP — each agent reports its own
 * `thought_level` options, and they differ per MODEL (Haiku exposes none at all).
 * This list is the vocabulary those values are read into, so a level one agent
 * lacks can still be mapped onto its nearest neighbour when a chat is forked.
 * `ultracode` is the one rung ACP does not report: Studio adds it to Claude and
 * implements it itself.
 */
export const AGENT_EFFORT_LEVELS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
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

/** One agent turn in the workspace: the live transcript + outcome. */
export interface AgentRun {
  id: string
  /** the chat tab this turn belongs to — turns never cross chats */
  chatId: string
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

/**
 * One message waiting behind the turn in progress.
 *
 * Typing while the agent works does not interrupt it: the message is parked on
 * its chat, in order, and the turn that settles sends the next one. The list is
 * the user's to arrange — reorder, edit, drop, or promote one to now.
 */
export interface QueuedMessage {
  id: string
  /** the message as typed, verbatim — what the turn it starts will carry */
  text: string
  createdAt: string
}

/** What POST /agent/submit did with the message: ran it, parked it, or neither. */
export interface AgentSubmitResult {
  /** the turn that started, when the chat was free */
  run?: AgentRun
  /** the message parked behind a running turn instead */
  queued?: QueuedMessage
  error?: string
}

/** The ongoing, resumable conversation of a chat and its harness.
 *  Survives studio restarts (persisted in the studio's home on this machine). */
export interface ConversationInfo {
  /** a resumable session exists → the next submit continues it (vs. starting fresh) */
  active: boolean
  /** successful turns recorded in the current conversation */
  turns: number
  /** which harness the conversation belongs to (resume only applies within it) */
  harness?: string
}

/** What an unnamed chat is called until its first instruction titles it. */
export const DEFAULT_CHAT_TITLE = 'New chat'

/**
 * One persistent machine-wide chat tab — Studio's unit of conversation.
 *
 * A chat is bound to its harness for life: the native session id, the transcript
 * and the resume semantics all belong to that one agent. Choosing the other
 * harness therefore FORKS a new chat (carrying a summary of this one) rather than
 * rewriting this one underneath the user.
 */
export interface ChatInfo {
  id: string
  /** tab label — derived from the first turn, renameable */
  title: string
  /** fixed at creation; see the fork rule above */
  harness: string
  /** per-chat model override WITHIN its harness; absent ⇒ the starred model */
  model?: string
  /** per-chat reasoning level; absent ⇒ whatever the agent itself is set to */
  effort?: AgentEffort
  /** the harness-native resumable session id backing this chat */
  sessionId?: string
  /** successful turns recorded in this chat */
  turns: number
  createdAt: string
  updatedAt: string
  /** workspace where the conversation was first opened */
  workspace?: string
  /** domains that workspace held at creation, for orientation in global history */
  origins?: string[]
  /** set when this chat was forked off another harness's chat */
  origin?: ChatOrigin
  /** this chat's own execution state — tabs run independently of each other */
  status: ChatStatus
  /** messages typed while a turn was running, in the order they will be sent */
  queued: QueuedMessage[]
}

/** Where a forked chat came from, and the briefing it was opened with. */
export interface ChatOrigin {
  chatId: string
  harness: string
  /** the transferred summary has not reached the harness yet */
  pendingHandoff: boolean
  /** the summary itself — the chat shows it as a collapsible chip, and keeps
   *  showing it after delivery: it is this conversation's first page. */
  summary: string
}

/** A chat is 'idle' until it has run a turn; afterwards it mirrors that turn. */
export type ChatStatus = 'idle' | AgentRunStatus

export interface ChatList {
  chats: ChatInfo[]
  /** the tab this workspace opens on; always one of the machine-wide `chats` */
  activeId: string
}

/** The agent's raw resumable session id, surfaced for manual view/edit in Settings. */
export interface AgentSessionInfo {
  sessionId: string | null
  turns: number
  harness?: string
}

export interface HarnessCapabilities {
  /** the ladder to assume until ACP reports this model's own — see AGENT_EFFORT_LEVELS */
  effortLevels: readonly AgentEffort[]
  accessLevels: readonly AgentAccess[]
  ask: boolean
  loadout: boolean
  /** Custom model-gateway wire contract this harness can consume in Studio. */
  gateway: 'anthropic' | 'responses' | 'none'
}

/** One local agent, probed over ACP: is it here, and which server answered. */
export interface HarnessPresence {
  id: string
  label: string
  /** the binary/command probed (e.g. 'claude') */
  bin: string
  ok: boolean
  /** the ACP agent server's version — not the CLI's own */
  version?: string
  /** human message — the ACP handshake, or install / PATH guidance when not ok */
  message: string
  capabilities: HarnessCapabilities
}

/**
 * The agent the next chat opens on, and every agent detected beside it.
 *
 * Nothing here is a setting: the default follows the preferred model (starred in
 * the composer), and `harnesses` is pure diagnostics — Settings lists it so you
 * can see which agents this machine actually has.
 *
 * `source` says WHY this agent, and 'fallback' is the one the GUI has to explain:
 * the starred model belongs to an agent this machine does not have, so chats open
 * on one it does. The star itself is untouched — `preferred` names the agent still
 * holding it, and the selection returns there the moment it is installed.
 */
export interface HarnessStatus extends HarnessPresence {
  /** every known harness, this one included */
  harnesses: HarnessPresence[]
  /** an environment/CLI override owns the selection, so nothing in the GUI moves it */
  locked: boolean
  source: 'environment' | 'starred' | 'default' | 'fallback'
  /** the starred agent, when it is NOT this one because it is missing here */
  preferred?: string
}

/**
 * One harness's selectable models, for the composer's picker.
 *
 * The picker lists EVERY harness at once — choosing across them is how a user
 * starts a chat on the other agent — so this describes an unselected harness too.
 */
export interface HarnessModelCatalog {
  harness: string
  label: string
  /** the binary is installed and answered the probe */
  available: boolean
  /** why not, when `available` is false */
  detail?: string
  /** what the harness picks when Studio overrides nothing */
  nativeModel?: string
  /** what a chat on this harness runs when it pins no model of its own — Studio's
   *  preferred model when the harness lists it, the native one otherwise */
  defaultModel?: string
  models: HarnessModelOption[]
}

/** Diagnostics reported by a disposable ACP session opened on the workspace root. */
export interface HarnessLoadout {
  /** ACP initialization and session creation both succeeded. */
  ok: boolean
  /** Human-readable result, or the failure reason when `ok` is false. */
  detail?: string
  /** Model selected by the agent before Studio applies its optional override. */
  nativeModel?: string
  /** Effective model after applying Studio's optional ACP session override. */
  model?: string
  modelSource?: 'studio' | 'agent'
  /** Models exposed by the ACP session's model configuration option. */
  models?: HarnessModelOption[]
  /** Reasoning level the session runs at before Studio applies its override. */
  nativeEffort?: AgentEffort
  /** Effective reasoning level after applying Studio's optional override. */
  effort?: AgentEffort
  /** The reasoning ladder THIS model exposes — empty/absent ⇒ it has none. */
  efforts?: HarnessEffortOption[]
  /** Workspace root passed to `session/new`. */
  cwd?: string
  /** ACP protocol version negotiated during initialization. */
  protocolVersion?: number
  agentName?: string
  agentVersion?: string
  probedAt: number
  source: 'acp'
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

/** One rung of a model's ACP reasoning ladder, named as the agent names it. */
export interface HarnessEffortOption {
  id: AgentEffort
  label: string
  description?: string
}

/** Agent spend accumulated from Studio's own runs on this machine (NOT the
 *  harness's complete machine-wide usage). Stored beside the global chats in the home. */
export interface AgentUsage {
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
  /** the chat this snapshot describes */
  chatId: string
  harness: string
  available: boolean
  /** the active or most-recent run of this chat (null if none yet) */
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

/** The harness-gateway config of this machine. */
export interface HarnessGatewayState {
  /** what is saved, enabled or not; null when nothing was ever saved */
  config: HarnessGatewayConfig | null
  /** the config that actually takes effect, else null */
  effective: HarnessGatewayConfig | null
  source: 'machine' | 'none'
}
