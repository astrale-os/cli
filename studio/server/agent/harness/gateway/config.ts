/**
 * gateway/config.ts — point the selected harness at an Anthropic-compatible
 * model gateway (e.g. an Astrale `ai-gateway` model node) instead of Claude
 * Code's built-in auth. Two scopes, layered:
 *   - per-domain : `<domain>/.domain-studio/harness-gateway.json` — AUTHORITATIVE
 *                  when present (its presence is the override, even when disabled).
 *   - global     : `~/.domain-studio/harness-gateway.json` — the studio-wide
 *                  default applied to every domain that has no local override.
 *
 * The config never escapes the studio's spawned child: `harnessGatewayEnv` turns
 * it into ANTHROPIC_* env that runner / ask / loadout merge into the `claude`
 * subprocess env ONLY — never the studio's own process env, the user's shell, or
 * a `claude` they run themselves outside the studio.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type {
  HarnessGatewayAuth,
  HarnessGatewayConfig,
  HarnessGatewayState,
} from '../../../../shared/types'

import { readJson, removeState, statePath, writeJson } from '../../../state/store'
import { acquireGatewayToken } from './token'

/** Per-domain file (lives under the domain's `.domain-studio/`, gitignored). */
const LOCAL_FILE = 'harness-gateway.json'
/** Studio-wide default — a sibling-named hidden dir in the user's home. */
const GLOBAL_FILE = join(homedir(), '.domain-studio', 'harness-gateway.json')

/** Coerce a wire/disk auth block into a well-formed discriminated union. Default
 *  is `mint` (no secret on disk). A legacy `{ apiKey }` shape maps to `token` mode. */
function normalizeAuth(input: any): HarnessGatewayAuth {
  if (input?.mode === 'token' || (input?.token != null && input?.mode == null))
    return { mode: 'token', token: typeof input.token === 'string' ? input.token.trim() : '' }
  if (input?.mode === 'host') return { mode: 'host' }
  const instance = typeof input?.instance === 'string' ? input.instance.trim() : ''
  return { mode: 'mint', ...(instance ? { instance } : {}) }
}

/** Coerce a wire/disk value into a well-formed config (trim, drop blanks). */
function normalize(input: any): HarnessGatewayConfig {
  const model = typeof input?.model === 'string' ? input.model.trim() : ''
  // back-compat: a pre-union config stored only `apiKey` → treat as a static token
  const authInput =
    input?.auth ??
    (typeof input?.apiKey === 'string' ? { mode: 'token', token: input.apiKey } : undefined)
  return {
    enabled: input?.enabled === true,
    baseUrl: typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : '',
    ...(model ? { model } : {}),
    auth: normalizeAuth(authInput),
  }
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

function readLocal(root: string): HarnessGatewayConfig | null {
  const raw = readJson<HarnessGatewayConfig | null>(root, LOCAL_FILE, null)
  return raw ? normalize(raw) : null
}

function readGlobal(): HarnessGatewayConfig | null {
  if (!existsSync(GLOBAL_FILE)) return null
  try {
    return normalize(JSON.parse(readFileSync(GLOBAL_FILE, 'utf8')))
  } catch {
    return null
  }
}

/** Write (or, on null, delete) the global default. Not under any domain root, so
 *  it bypasses the store's domain-scoped write-allowlist by design. */
function writeGlobal(cfg: HarnessGatewayConfig | null): void {
  if (cfg === null) {
    if (existsSync(GLOBAL_FILE)) rmSync(GLOBAL_FILE, { force: true })
    return
  }
  mkdirSync(dirname(GLOBAL_FILE), { recursive: true })
  writeFileSync(GLOBAL_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 })
  chmodSync(GLOBAL_FILE, 0o600)
}

/** Resolve the layered state. A PRESENT local override wins outright — even when
 *  disabled, which is exactly how you turn the gateway off for one domain despite
 *  a global default. With no local override, the global default applies. */
export function getHarnessGatewayState(root: string): HarnessGatewayState {
  const local = readLocal(root)
  const global = readGlobal()
  if (local) {
    return {
      local,
      global,
      effective: local.enabled ? local : null,
      source: local.enabled ? 'domain' : 'none',
    }
  }
  return {
    local: null,
    global,
    effective: global?.enabled ? global : null,
    source: global?.enabled ? 'global' : 'none',
  }
}

export interface SetHarnessGatewayInput {
  scope: 'domain' | 'global'
  config: Partial<HarnessGatewayConfig>
}

/** Persist the config to the chosen scope. Writing GLOBAL also clears any local
 *  override so this domain (and every un-overridden one) inherits it — that is the
 *  "apply to all domains" intent. */
export function setHarnessGateway(
  root: string,
  input: SetHarnessGatewayInput,
): HarnessGatewayState {
  const cfg = normalize(input.config)
  validateEnabledConfig(cfg)
  if (input.scope === 'global') {
    writeGlobal(cfg)
    removeState(root, LOCAL_FILE)
  } else {
    writeJson(root, LOCAL_FILE, cfg)
    chmodSync(statePath(root, LOCAL_FILE), 0o600)
  }
  return getHarnessGatewayState(root)
}

/** Drop the override at a scope (revert to the layer below / default harness auth). */
export function clearHarnessGateway(root: string, scope: 'domain' | 'global'): HarnessGatewayState {
  if (scope === 'global') writeGlobal(null)
  else removeState(root, LOCAL_FILE)
  return getHarnessGatewayState(root)
}

/** The config that takes effect for a domain (or undefined ⇒ default harness auth). */
export function resolveHarnessGateway(root: string): HarnessGatewayConfig | undefined {
  return getHarnessGatewayState(root).effective ?? undefined
}

/** The gateway audience (origin) for a domain's effective config — the token
 *  audience to mint/relay for. Null when no gateway is configured / URL invalid. */
export function gatewayAudience(root: string): string | null {
  const cfg = resolveHarnessGateway(root)
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
 * Resolve the ANTHROPIC_* env for a domain's harness child. Derives the gateway
 * audience from the URL, acquires the bearer token per auth mode (mint / static /
 * host-supplied), and sets `ANTHROPIC_AUTH_TOKEN` (Authorization: Bearer — the
 * custom-gateway path, which sidesteps the x-api-key approval prompt) plus the
 * model labels. The Astrale gateway pins the real model by URL, so `model` is
 * only for display.
 */
export async function resolveHarnessEnv(root: string): Promise<HarnessEnvResult> {
  const cfg = resolveHarnessGateway(root)
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
