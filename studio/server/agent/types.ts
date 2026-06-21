/**
 * agent/types.ts — the harness-agnostic contract for "run one agent turn".
 *
 * A *harness* is whatever local AI agent does the edits (Claude Code, Codex, …).
 * The studio never talks to a model API directly; it shells out to the harness
 * the user already has running locally (no cloud API key of our own). Each
 * harness maps its native streaming output onto `AgentStreamEvent`s and returns
 * a final text blob (which carries the machine-state reply block).
 */
import type { AgentEffort, AgentEventKind, HarnessLoadout } from '../../shared/types'

/** A single normalized activity event emitted while the harness runs. */
export interface AgentStreamEvent {
  kind: AgentEventKind
  text: string
  tool?: string
  target?: string
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
  /** harness reasoning effort for this turn */
  effort?: AgentEffort
  /** path to a generated MCP config exposing the studio write-back bridge */
  mcpConfigPath?: string
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
  /** total tokens processed (input + output + cache) */
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
  /** harness reasoning effort for this side question */
  effort?: AgentEffort
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

export interface AgentHarness {
  /** stable id, e.g. 'claude' | 'mock' | 'codex' */
  id: string
  /** human label for the UI */
  label: string
  /** is the underlying CLI/binary actually invokable here? */
  isAvailable(): Promise<boolean>
  /** optional: a richer install probe for the UI (version + reason). Harnesses that
   *  omit it fall back to isAvailable(). */
  health?(): Promise<HarnessHealth>
  run(input: AgentTurnInput): Promise<AgentTurnResult>
  /** optional: answer a quick forked side question (Ask). Harnesses without a
   *  fork concept simply omit this; the studio falls back gracefully. */
  ask?(input: AskInput): Promise<AskResult>
  /** optional: report what the harness ACTUALLY loaded for `root` (skills, MCP,
   *  tools, agents) — a read-only window into the agent for the Settings page.
   *  Harnesses without an introspectable loadout omit it. */
  loadout?(root: string): Promise<HarnessLoadout>
  /** optional: the raw SKILL.md for a skill command, so the UI can show it. */
  skillContent?(
    root: string,
    command: string,
  ): Promise<{ command: string; content: string; path: string } | null>
}
