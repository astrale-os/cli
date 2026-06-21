/**
 * env.ts — the env-vars editor backend. Reconciles a domain's `.env.<env>` file
 * (the actual secrets/vars, dotenv format) against the `Env` interface in
 * `env.ts` (the typed contract, parsed by buildEnvFields), and is the ONE place
 * the otherwise read-only studio writes a domain file — the explicit exception
 * the user sanctioned for env editing.
 *
 * Env injection is adapter-specific (cloudflare dev: merged into wrangler vars;
 * cloudflare/astrale prod: pushed to the worker/platform secret store), but the
 * secrets FILE is universal (`@astrale-os/sdk` loads `secrets: '.env.<env>'`
 * wholesale via its dotenv parser). We edit that file; we never deploy.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { EnvFileModel, EnvName, EnvVarRow } from '../../shared/types'

import { buildEnvFields } from '../introspect/anatomy-extras'

const ENV_NAMES: EnvName[] = ['dev', 'prod']
export const isEnvName = (v: unknown): v is EnvName =>
  typeof v === 'string' && (ENV_NAMES as string[]).includes(v)

/** The conventional secrets file for an env — what create-astrale-domain scaffolds
 *  and every domain uses. The filename is fixed, so no path-traversal is possible. */
const envFileName = (env: EnvName) => `.env.${env}`

/** Mirror of the SDK's minimal dotenv parser (`@astrale-os/sdk` cli/dotenv) so the
 *  studio reads values exactly as the deploy path will: `#` comments, `export`,
 *  quotes (single = literal), `${VAR}` interpolation against earlier keys. */
function parseDotenv(contents: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of contents.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    const single = value.length >= 2 && value.startsWith("'") && value.endsWith("'")
    if (single || (value.length >= 2 && value.startsWith('"') && value.endsWith('"')))
      value = value.slice(1, -1)
    out[m[1]] = single ? value : value.replace(/\$\{(\w+)\}/g, (_, n: string) => out[n] ?? '')
  }
  return out
}

/** astrale.config.ts with comments stripped — so a COMMENTED-OUT adapter block
 *  (e.g. the scaffold's "swap to cloudflare" example) never reads as active config.
 *  The `[^:]` guard keeps `https://` in URLs from being mistaken for a line comment. */
function configText(root: string): string {
  let s: string
  try {
    s = readFileSync(join(root, 'astrale.config.ts'), 'utf8')
  } catch {
    return ''
  }
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Is this `.env.<env>` wired into astrale.config's ACTIVE `secrets:`? (vs convention only) */
function isConfigured(config: string, env: EnvName): boolean {
  return new RegExp(`secrets\\s*:\\s*['"]\\.env\\.${env}['"]`).test(config)
}

function adapterOf(config: string): EnvFileModel['adapter'] {
  if (/\bastrale\s*\(/.test(config)) return 'astrale'
  if (/\bcloudflare\s*\(/.test(config)) return 'cloudflare'
  return 'unknown'
}

/** Build the merged model for one env: env.ts fillable fields ⨯ the `.env.<env>` values. */
export function readEnvModel(root: string, env: EnvName): EnvFileModel {
  const file = envFileName(env)
  const abs = join(root, file)
  const exists = existsSync(abs)
  const values = exists ? parseDotenv(readFileSync(abs, 'utf8')) : {}

  // env.ts contract — only fillable (non-binding) fields; bindings are adapter-injected.
  const declared = buildEnvFields(root).filter((f) => f.secret)
  const declaredNames = new Set(declared.map((f) => f.name))

  const rows: EnvVarRow[] = declared.map((f) => ({
    name: f.name,
    value: values[f.name] ?? '',
    declared: true,
    optional: f.optional,
    ...(f.doc ? { doc: f.doc } : {}),
  }))
  // orphans — present in the file but not declared in env.ts (kept, flagged, removable)
  for (const [name, value] of Object.entries(values)) {
    if (!declaredNames.has(name)) rows.push({ name, value, declared: false, optional: true })
  }

  const requiredMissing = rows.filter((r) => r.declared && !r.optional && r.value === '').length
  const config = configText(root)
  return {
    env,
    file,
    configured: isConfigured(config, env),
    exists,
    adapter: adapterOf(config),
    rows,
    requiredMissing,
  }
}

/** Quote a value for the dotenv file: bare when safe, single-quoted (literal) for
 *  most specials, double-quoted+escaped only when it contains a single quote. */
function formatValue(v: string): string {
  if (v === '') return ''
  if (/^[A-Za-z0-9_./:@+-]+$/.test(v)) return v
  if (!v.includes("'")) return `'${v}'`
  return `"${v.replace(/(["\\$`])/g, '\\$1')}"`
}

/** Apply key→value updates to dotenv text IN PLACE — comments, blank lines and key
 *  order are preserved; `null` deletes a key; unknown keys are appended. */
function applyUpdates(contents: string, updates: Record<string, string | null>): string {
  const lines = contents.split('\n')
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const m = /^(\s*(?:export\s+)?)([A-Za-z_]\w*)\s*=.*$/.exec(line)
    if (m && !line.trim().startsWith('#') && m[2] in updates) {
      const key = m[2]
      seen.add(key)
      const val = updates[key]
      if (val === null) continue // drop the line
      out.push(`${m[1]}${key}=${formatValue(val)}`)
      continue
    }
    out.push(line)
  }
  // preserve a single trailing newline while appending new keys after content
  const trailing = out.length > 0 && out[out.length - 1] === ''
  if (trailing) out.pop()
  for (const [key, val] of Object.entries(updates)) {
    if (val === null || seen.has(key) || !/^[A-Za-z_]\w*$/.test(key)) continue
    out.push(`${key}=${formatValue(val)}`)
  }
  out.push('') // final newline
  return out.join('\n')
}

const SCAFFOLD_HEADER = (env: EnvName) =>
  `# ${env === 'dev' ? 'Dev' : 'Prod'} secrets — the ENTIRE file is treated as secrets by the adapter.\n# Gitignored. Edited via the Domain Studio settings.\n`

/** Write key→value updates to `.env.<env>`, creating it if absent. Returns the
 *  fresh model. Confined to `<root>/.env.<env>` (fixed name, validated inside root). */
export function writeEnvUpdates(
  root: string,
  env: EnvName,
  updates: Record<string, string | null>,
): EnvFileModel {
  const abs = join(root, envFileName(env))
  if (!resolve(abs).startsWith(resolve(root)))
    throw new Error('refused: path escapes the domain root')
  const prior = existsSync(abs) ? readFileSync(abs, 'utf8') : SCAFFOLD_HEADER(env)
  writeFileSync(abs, applyUpdates(prior, updates), 'utf8')
  return readEnvModel(root, env)
}
