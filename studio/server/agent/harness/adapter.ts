/**
 * harness/adapter.ts — the executable boundary implemented by each local agent
 * harness.
 *
 * A *harness* is whatever local AI agent does the edits (Claude Code, Codex, …).
 * The studio never talks to a model API directly; it shells out to the harness
 * the user already has running locally (no cloud API key of our own). Each
 * harness maps its native streaming output onto `AgentStreamEvent`s and returns
 * a final text blob (which carries the machine-state reply block).
 */
import type {
  AgentAccess,
  AgentEffort,
  AgentEventKind,
  HarnessCapabilities,
  HarnessLoadout,
} from '../../../shared/types'

/** A single normalized activity event emitted while the harness runs. */
export interface AgentStreamEvent {
  kind: AgentEventKind
  text: string
  tool?: string
  target?: string
}

/** Harness-neutral description of one stdio MCP server. Each harness is
 * responsible for expressing this in its native CLI/config shape. */
export interface HarnessMcpServer {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  required?: boolean
  /** Studio's run-scoped write-back tools are user-authorized by the submit. */
  approvalMode?: 'auto' | 'prompt' | 'writes' | 'approve'
  enabledTools?: string[]
  /** In-process harnesses may invoke the same grant without spawning stdio. */
  invoke?: (tool: string, args: Record<string, unknown>) => Promise<unknown>
}

export interface AgentTurnInput {
  /** the domain repo root — the agent's working directory */
  root: string
  /** the turn message (scaffolded handoff / delta) */
  prompt: string
  /** appended to the harness's default system prompt — the reply protocol */
  appendSystemPrompt?: string
  /** prior harness session id → resume the same conversation */
  sessionId?: string
  /** explicit model override; absent preserves the harness's native config/default */
  model?: string
  /** harness reasoning effort for this turn */
  effort?: AgentEffort
  /** authority granted to the local harness */
  access?: AgentAccess
  /** generated MCP servers exposing Studio write-back */
  mcpServers?: HarnessMcpServer[]
  /** extra env merged into the harness CHILD process only. Never touches the
   *  studio's own env or the user's shell/global harness process. */
  env?: Record<string, string>
  /** abort the turn (user pressed Cancel) */
  signal: AbortSignal
  /** called for every normalized activity event */
  onEvent: (e: AgentStreamEvent) => void
}

export interface AgentTurnResult {
  /** session id to persist for the next turn's resume */
  sessionId?: string
  /** the agent's final message text (parsed for the machine-state reply block) */
  finalText: string
  costUsd?: number
  numTurns?: number
  /** total token usage reported by the harness */
  tokens?: number
  isError: boolean
  errorMessage?: string
  /** the resume sessionId we passed was rejected by the harness (the conversation
   *  no longer exists / expired). The runner uses this to transparently restart the
   *  turn as a fresh conversation instead of failing — and to know it's safe to drop
   *  the stored id (vs. keeping it across an unrelated transient failure). */
  resumeRejected?: boolean
}

/** A quick, ephemeral "side question" — a FORK of the conversation that inherits
 *  the parent's context but writes nothing back to it (see agent/ask.ts). Streamed. */
export interface AskInput {
  root: string
  /** the composed question (prefix + injected target context + the user's text) */
  prompt: string
  /** the ask protocol, appended to the harness default system prompt */
  appendSystemPrompt?: string
  /** the domain's live conversation session id to FORK from (undefined ⇒ fresh, no fork) */
  sessionId?: string
  /** explicit model override; absent preserves the harness's native config/default */
  model?: string
  /** harness reasoning effort for this side question */
  effort?: AgentEffort
  /** authority granted to the local harness */
  access?: AgentAccess
  /** extra env merged into the harness child only — see AgentTurnInput.env */
  env?: Record<string, string>
  signal: AbortSignal
  /** called with each chunk of the answer as it streams in */
  onDelta: (text: string) => void
}

export interface AskResult {
  text: string
  isError: boolean
  errorMessage?: string
}

/** A richer install/health probe result for the UI (binary found? which version?). */
export interface HarnessHealth {
  ok: boolean
  version?: string
  /** the binary / command probed (so the user can fix PATH) */
  bin?: string
  /** human-readable reason when not ok */
  detail?: string
}

export interface HarnessLoadoutOptions {
  /** Child-only environment overrides used while probing the harness. */
  env?: Record<string, string>
  /** Studio's per-domain override for the selected harness. */
  model?: string
  /** Bypass the adapter's short-lived probe cache for an explicit user re-probe. */
  refresh?: boolean
}

export interface AgentHarness {
  /** stable id, e.g. 'claude' | 'mock' | 'codex' */
  id: string
  /** human label for the UI */
  label: string
  capabilities: HarnessCapabilities
  /** is the underlying CLI/binary actually invokable here? */
  isAvailable(signal?: AbortSignal): Promise<boolean>
  /** optional: a richer install probe for the UI (version + reason). Harnesses that
   *  omit it fall back to isAvailable(). */
  health?(signal?: AbortSignal): Promise<HarnessHealth>
  run(input: AgentTurnInput): Promise<AgentTurnResult>
  /** optional: answer a quick forked side question (Ask). Harnesses without a
   *  fork concept simply omit this; the studio falls back gracefully. */
  ask?(input: AskInput): Promise<AskResult>
  /** optional: report what the harness ACTUALLY loaded for `root` (skills, MCP,
   *  tools, agents) — a read-only window into the agent for the Settings page.
   *  Harnesses without an introspectable loadout omit it. `env` (e.g. a custom
   *  model gateway) is merged into the probe child so the reported model reflects it. */
  loadout?(root: string, options?: HarnessLoadoutOptions): Promise<HarnessLoadout>
  /** optional: the raw SKILL.md for a skill command, so the UI can show it. */
  skillContent?(
    root: string,
    command: string,
  ): Promise<{ command: string; content: string; path: string } | null>
}

/** Normalize optional rich health probes into one route-facing result. */
export async function inspectHarnessHealth(
  harness: AgentHarness,
  signal?: AbortSignal,
): Promise<HarnessHealth> {
  if (harness.health) return harness.health(signal)
  return {
    ok: await harness.isAvailable(signal),
    bin: harness.id,
  }
}
