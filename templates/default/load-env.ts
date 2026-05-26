import { readFileSync } from 'node:fs'

/**
 * Load a `.env` file into `process.env` and return — a tiny dotenv reader.
 *
 * Semantics:
 *   - **gaps-only**: an already-set env var is never overwritten (the shell
 *     wins over the file).
 *   - `${VAR}` substitution against already-set vars (put raw IDs first,
 *     derived values below).
 *   - surrounding quotes stripped; blank lines and `#` comments ignored;
 *     a leading `export ` is tolerated.
 *   - no-op if the file is absent (CI-safe).
 *
 * Call it from `lifecycle.ts`'s `preUp` hook with `join(ctx.domainDir, '.env')`.
 * `preUp` runs BEFORE the CLI resolves `forwardEnv`/`forwardEnvOptional` and
 * writes `worker/.dev.vars`, so secrets declared there are present without a
 * manual `source .env`, from any cwd (incl. the multi-domain `dev up`
 * fan-out). Note: `extraDevVars` literals are snapshotted at module-import
 * time — before `preUp` — so a `.env`-provided secret must go through
 * `forwardEnv`, not `extraDevVars`.
 */
export function loadEnv(path: string): void {
  let contents: string
  try {
    contents = readFileSync(path, 'utf-8')
  } catch {
    return
  }

  for (const raw of contents.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?(\w+)\s*=\s*(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key]) continue
    let value = rawValue.trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '')
  }
}
