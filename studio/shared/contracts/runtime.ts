/**
 * Shared Studio runtime and API transport contracts.
 *
 * This owner contains cross-process notifications, Studio runtime settings, and
 * CLI-owned update reports. It does not define schema or persisted workspace state.
 */

import type { AgentAccess, AgentEffort, AgentEvent, AgentRun } from './agent'

export type StudioEvent =
  | { type: 'schema-diff'; domainId: string; renderFingerprint: string }
  | { type: 'anatomy-diff'; domainId: string }
  | { type: 'comments'; domainId: string }
  | { type: 'compile-error'; domainId: string; message: string }
  | { type: 'resolving'; domainId: string }
  | { type: 'agent-run'; domainId: string; run: AgentRun }
  | { type: 'agent-event'; domainId: string; runId: string; event: AgentEvent }
  | { type: 'hello'; domains: string[] }
  | { type: 'workspace'; domains: string[] }

/** Per-domain overrides stored at `.domain-studio/settings.json`. */
export interface StudioSettings {
  /** Harness-native reasoning effort (default 'high') */
  agentEffort: AgentEffort
  /** workspace = sandboxed edits; full = unrestricted local automation */
  agentAccess: AgentAccess
  /** Optional model override, independently remembered for each harness id. */
  agentModels: Record<string, string>
  /** folder under the domain root scanned for integrations (default 'integrations') */
  integrationsDir: string
  /** schema/core extraction subprocess timeout in ms (default 20000) */
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
