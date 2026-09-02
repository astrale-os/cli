/**
 * gateway/config.ts — point the selected harness at an Anthropic-compatible
 * model gateway (e.g. an Astrale `ai-gateway` model node) instead of Claude
 * Code's built-in auth.
 *
 * One scope: the machine. The agent works in the whole workspace, so a gateway is a
 * preference of the person running the studio, kept in its home beside the settings
 * (`<home>/studio/harness-gateway.json`). Earlier per-domain and legacy-global files
 * are deliberately ignored: the machine setting is the only source of truth.
 *
 * The config never escapes the studio's spawned child: `resolveHarnessEnv` turns
 * it into ANTHROPIC_* env that runner / ask / ACP diagnostics merge into the `claude`
 * subprocess env ONLY — never the studio's own process env, the user's shell, or
 * a `claude` they run themselves outside the studio.
 */
import { chmodSync } from 'node:fs'

import type {
  HarnessGatewayAuth,
  HarnessGatewayConfig,
  HarnessGatewayState,
} from '../../../../shared/types'

import { studioHome } from '../../../home'
import { asJsonRecord, asString } from '../../../json'
import { readJson, removeState, statePath, writeJson } from '../../../state/store'
import { acquireGatewayToken } from './token'

const FILE = 'harness-gateway.json'

/** Coerce a wire/disk auth block into a well-formed discriminated union. Default
 *  is `mint` (no secret on disk). A legacy `{ apiKey }` shape maps to `token` mode. */
function normalizeAuth(input: unknown): HarnessGatewayAuth {
  const record = asJsonRecord(input)
  if (record?.mode === 'token' || (record?.token != null && record?.mode == null))
    return { mode: 'token', token: asString(record.token)?.trim() ?? '' }
  if (record?.mode === 'host') return { mode: 'host' }
  const instance = asString(record?.instance)?.trim() ?? ''
  return { mode: 'mint', ...(instance ? { instance } : {}) }
}

/** Coerce a wire/disk value into a well-formed config (trim, drop blanks). */
function normalize(input: unknown): HarnessGatewayConfig {
  const record = asJsonRecord(input) ?? {}
  const model = asString(record.model)?.trim() ?? ''
  // back-compat: a pre-union config stored only `apiKey` → treat as a static token
  const authInput =
    record.auth ??
    (typeof record.apiKey === 'string' ? { mode: 'token', token: record.apiKey } : undefined)
  return {
    enabled: record.enabled === true,
    baseUrl: asString(record.baseUrl)?.trim() ?? '',
    ...(model ? { model } : {}),
    auth: normalizeAuth(authInput),
  }
}

function decodeConfig(value: unknown): HarnessGatewayConfig | undefined {
  return asJsonRecord(value) ? normalize(value) : undefined
}

function validateEnabledConfig(config: HarnessGatewayConfig): void {
  if (!config.enabled) return
  if (!config.baseUrl) throw new Error('gateway base URL is required while enabled')
  let url: URL
  try {
    url = new URL(config.baseUrl)
  } catch {
    throw new Error(`invalid gateway base URL: ${config.baseUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('gateway base URL must use http:// or https://')
  if (config.auth.mode === 'token' && !config.auth.token)
    throw new Error('gateway static token is required in token mode')
}

function readStored(): HarnessGatewayConfig | null {
  return readJson(studioHome(), FILE, decodeConfig, null)
}

/** The gateway as configured on this machine, and whether it takes effect. */
export function getHarnessGatewayState(): HarnessGatewayState {
  const config = readStored()
  return {
    config,
    effective: config?.enabled ? config : null,
    source: config?.enabled ? 'machine' : 'none',
  }
}

/** Persist the config. Saved with owner-only permissions: it may hold a token. */
export function setHarnessGateway(config: Partial<HarnessGatewayConfig>): HarnessGatewayState {
  const cfg = normalize(config)
  validateEnabledConfig(cfg)
  writeJson(studioHome(), FILE, cfg)
  chmodSync(statePath(studioHome(), FILE), 0o600)
  return getHarnessGatewayState()
}

/** Drop the config: the harness goes back to its own auth. */
export function clearHarnessGateway(): HarnessGatewayState {
  removeState(studioHome(), FILE)
  return getHarnessGatewayState()
}

/** The config that takes effect (or undefined ⇒ default harness auth). */
export function resolveHarnessGateway(): HarnessGatewayConfig | undefined {
  return getHarnessGatewayState().effective ?? undefined
}

/** The gateway audience (origin) of the effective config — the token audience to
 *  mint/relay for. Null when no gateway is configured / URL invalid. */
export function gatewayAudience(): string | null {
  const cfg = resolveHarnessGateway()
  if (!cfg?.enabled || !cfg.baseUrl) return null
  try {
    return new URL(cfg.baseUrl).origin
  } catch {
    return null
  }
}

/** Either the ANTHROPIC_* env to inject (empty ⇒ no gateway configured), or a
 *  human error when a gateway IS configured but its token can't be obtained — so
 *  callers fail loudly instead of silently falling back to the default Claude auth. */
export type HarnessEnvResult =
  | { ok: true; env: Record<string, string> }
  | { ok: false; error: string }

/**
 * Resolve the ANTHROPIC_* env for the harness child. Derives the gateway audience
 * from the URL, acquires the bearer token per auth mode (mint / static / host-supplied),
 * and sets `ANTHROPIC_AUTH_TOKEN` (Authorization: Bearer — the custom-gateway path,
 * which sidesteps the x-api-key approval prompt) plus the model labels. The Astrale
 * gateway pins the real model by URL, so `model` is only for display.
 */
export async function resolveHarnessEnv(): Promise<HarnessEnvResult> {
  const cfg = resolveHarnessGateway()
  if (!cfg || !cfg.enabled) return { ok: true, env: {} }
  if (!cfg.baseUrl) return { ok: false, error: 'gateway base URL is required while enabled' }
  let audience: string
  try {
    const url = new URL(cfg.baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return { ok: false, error: 'gateway base URL must use http:// or https://' }
    audience = url.origin
  } catch {
    return { ok: false, error: `invalid gateway base URL: ${cfg.baseUrl}` }
  }
  let token: string
  try {
    token = await acquireGatewayToken(cfg, audience)
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) }
  }
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: cfg.baseUrl,
    ANTHROPIC_AUTH_TOKEN: token,
  }
  if (cfg.model) {
    env.ANTHROPIC_MODEL = cfg.model
    env.ANTHROPIC_SMALL_FAST_MODEL = cfg.model
  }
  return { ok: true, env }
}
