/**
 * Environment file editor. Reconciles a domain's `.env.<env>` file
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
import { readConfigPreview } from '../introspect/config-preview'
import { parseDotenvPreview } from './dotenv-preview'

const ENV_NAMES: EnvName[] = ['dev', 'prod']
export const isEnvName = (v: unknown): v is EnvName =>
  typeof v === 'string' && (ENV_NAMES as string[]).includes(v)

/** The conventional secrets file for an env — what create-astrale-domain scaffolds
 *  and every domain uses. The filename is fixed, so no path-traversal is possible. */
const envFileName = (env: EnvName) => `.env.${env}`

/** Build the merged model for one env: env.ts fillable fields ⨯ the `.env.<env>` values. */
export function readEnvModel(root: string, env: EnvName): EnvFileModel {
  const file = envFileName(env)
  const abs = join(root, file)
  const exists = existsSync(abs)
  const values = exists ? parseDotenvPreview(readFileSync(abs, 'utf8')) : {}

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
  const config = readConfigPreview(root)
  return {
    env,
    file,
    configured: config.configuredSecretFiles.includes(file),
    exists,
    adapter: config.adapter,
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
