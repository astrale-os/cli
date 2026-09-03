/**
 * Shared Studio runtime and API transport contracts.
 *
 * This owner contains cross-process notifications, Studio runtime settings, and
 * CLI-owned update reports. It does not define schema or persisted workspace state.
 */

import type { AgentAccess, AgentEvent, AgentRun } from './agent'

export type IntrospectionPriority = 'reader' | 'background'
export type IntrospectionPhase =
  | 'queued'
  | 'cache-key'
  | 'cache-read'
  | 'dependencies'
  | 'runtime-extract'
  | 'static-overlay'
  | 'fingerprint'
  | 'cache-write'
  | 'anatomy'
  | 'complete'

/** Live and most-recent timings for one Domain's schema preparation. */
export interface DomainIntrospectionTiming {
  domainId: string
  priority: IntrospectionPriority
  status: 'queued' | 'running' | 'complete' | 'failed'
  phase: IntrospectionPhase
  queuedAt: string
  startedAt?: string
  completedAt?: string
  elapsedMs: number
  phasesMs: Partial<Record<IntrospectionPhase, number>>
  result?: 'disk-cache' | 'built' | 'failed'
  error?: string
}

/** Process-wide introspection queue and the latest run observed for each Domain. */
export interface IntrospectionStatus {
  concurrency: number
  active: string[]
  queued: { reader: string[]; background: string[] }
  domains: DomainIntrospectionTiming[]
}

export type StudioEvent =
  | { type: 'schema-diff'; domainId: string; renderFingerprint: string }
  | { type: 'anatomy-diff'; domainId: string }
  /** a referenced Dataset module or the project configuration changed */
  | { type: 'datasets'; domainId: string }
  | { type: 'comments'; domainId: string }
  | { type: 'compile-error'; domainId: string; message: string }
  | { type: 'resolving'; domainId: string }
  | { type: 'agent-run'; chatId: string; run: AgentRun }
  /** the tab strip changed for a reason no turn announced — a queued message
   *  added, reordered, edited or dropped in one window, seen in every other */
  | { type: 'chats' }
  | { type: 'agent-event'; chatId: string; runId: string; event: AgentEvent }
  | { type: 'hello'; domains: string[] }
  | { type: 'workspace'; domains: string[] }

/**
 * The one model new chats open on — starred in the composer.
 *
 * There is exactly one, across every agent: it names the model AND, through it,
 * the agent a fresh chat starts on. Null until the user stars something, which
 * leaves each harness on its own built-in default.
 */
export interface AgentModelPreference {
  harness: string
  model: string
}

/**
 * Studio-wide overrides, stored once in the studio's home on this machine
 * (`~/.astrale/studio/settings.json`). These configure the TOOL, not a domain or a
 * workspace: they follow the person, whatever is open.
 */
export interface StudioSettings {
  /** workspace = sandboxed edits; full = unrestricted local automation */
  agentAccess: AgentAccess
  /** the starred model for new chats; null ⇒ each harness uses its own default */
  agentModel: AgentModelPreference | null
  /** folder under the domain root scanned for integrations (default 'integrations') */
  integrationsDir: string
  /** schema/core extraction subprocess timeout in ms (default 60000) */
  introspectTimeoutMs: number
  /** how often the per-domain instance status refreshes, ms (default 30000) */
  instancePollMs: number
  /** how often the studio re-checks for stale schema / updates, ms (default 600000) */
  updatesPollMs: number
  /** timeout when probing a live view URL from the instance, ms (default 8000) */
  viewProbeTimeoutMs: number
}

/** The Astrale CLI's `astrale update --check --json` report. */
export interface StaleReport {
  stale: boolean
  cli: { stale: boolean; managed: boolean; current?: string; latest?: string; channel?: string }
  skills: {
    status: 'current' | 'update-available' | 'repair-needed' | 'unavailable' | 'skipped'
    error?: string
  }
  sdk: {
    stale: boolean
    inProject: boolean
    outdated: { pkg: string; current: string; latest: string }[]
  }
}
