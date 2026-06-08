import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { paths } from './env'

/**
 * `astrale browser` is a thin orchestrator over `agent-browser`
 * (https://github.com/vercel-labs/agent-browser) — the Rust browser-automation
 * CLI that AI agents drive. We own only the *session*: resolve the active
 * instance's GUI origin, pin a persistent per-instance profile so the WorkOS
 * login cookie survives across runs, and verify auth. Driving (snapshot/click/
 * eval/…) is agent-browser's job, invoked directly by the agent afterward.
 *
 * Why a profile and not an injected token: the GUI session is an httpOnly
 * sealed cookie (`astrale_router_session`) with no token-injection path, so the
 * only way to "use my session" is to drive a browser whose profile already
 * holds the cookie — minted once via interactive login, reused thereafter.
 */

export const BROWSER_DIR = join(paths.home, 'browser')
export const BROWSER_SESSION_PATH = join(paths.home, 'browser.json')
export const AGENT_BROWSER_REPO = 'vercel-labs/agent-browser'

/** Per-instance persistent profile dir handed to `agent-browser --profile`. */
export function profileDirFor(host: string): string {
  return join(BROWSER_DIR, host)
}

/** The last-connected browser session, read by agents to know how to drive. */
export type BrowserSession = {
  /** GUI origin, e.g. `https://alpha1.eu.astrale.ai`. */
  url: string
  host: string
  /** Profile dir, or null when attached to an external Chrome over CDP. */
  profile: string | null
  /** CDP endpoint (`9222` or a ws URL) when in attach mode. */
  cdp: string | null
  email?: string
  updatedAt: string
}

export async function readSession(): Promise<BrowserSession | null> {
  try {
    return JSON.parse(await readFile(BROWSER_SESSION_PATH, 'utf8')) as BrowserSession
  } catch {
    return null
  }
}

export async function saveSession(session: BrowserSession): Promise<void> {
  await mkdir(paths.home, { recursive: true })
  await writeFile(BROWSER_SESSION_PATH, `${JSON.stringify(session, null, 2)}\n`)
}

/** Resolve `agent-browser` on PATH; null when not installed. */
export async function findAgentBrowser(): Promise<string | null> {
  const proc = Bun.spawn(['command', '-v', 'agent-browser'], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const out = (await new Response(proc.stdout).text()).trim()
  await proc.exited
  return proc.exitCode === 0 && out ? out : null
}

export type AbResult = {
  ok: boolean
  data: unknown
  error: string | null
}

/**
 * Connection target for an agent-browser invocation: either a persistent
 * profile dir or a CDP endpoint (mutually exclusive).
 */
export type AbTarget = { profile?: string; cdp?: string }

/**
 * Run an `agent-browser` command with `--json` and parse its envelope
 * (`{success, data, error}`). Global flags (`--profile`/`--cdp`/`--headed`)
 * precede the subcommand; `--json` trails the args, matching the CLI's parser.
 */
export async function ab(
  args: string[],
  opts: AbTarget & { headed?: boolean } = {},
): Promise<AbResult> {
  const argv = ['agent-browser']
  if (opts.profile) argv.push('--profile', opts.profile)
  if (opts.cdp) argv.push('--cdp', opts.cdp)
  if (opts.headed) argv.push('--headed')
  argv.push(...args, '--json')

  const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited

  try {
    const parsed = JSON.parse(stdout) as { success?: boolean; data?: unknown; error?: string }
    if (parsed && typeof parsed === 'object' && 'success' in parsed) {
      return { ok: !!parsed.success, data: parsed.data ?? null, error: parsed.error ?? null }
    }
  } catch {
    // fall through to exit-code interpretation
  }
  return { ok: proc.exitCode === 0, data: null, error: stderr.trim() || null }
}

// Reads the GUI session from whatever origin the page currently sits on. During
// an interactive login the page is on the IdP origin, where `/auth/me` 404s and
// the fetch rejects → {authed:false}; once the router redirects back to the GUI
// it resolves to the authenticated user. Returned as a value (not top-level
// await — agent-browser's `eval` forbids it) so page.evaluate auto-resolves it.
const AUTH_EVAL =
  "fetch('/auth/me',{credentials:'include'})" +
  '.then(r=>r.json())' +
  '.then(j=>({authed:!!j.authenticated,email:j.user&&j.user.email}))' +
  '.catch(()=>({authed:false}))'

export type AuthState = { authed: boolean; email?: string }

function readAuthResult(res: AbResult): AuthState {
  const result = (res.data as { result?: unknown } | null)?.result
  if (result && typeof result === 'object') {
    const r = result as { authed?: boolean; email?: string }
    return { authed: !!r.authed, email: r.email }
  }
  return { authed: false }
}

/**
 * Poll auth on the current page (no navigation — safe during login redirects).
 * Pass `headed:true` while a sign-in window is open: agent-browser defaults to
 * headless, so an unflagged command flips the live window back to headless and
 * closes it.
 */
export async function pollAuth(target: AbTarget & { headed?: boolean }): Promise<AuthState> {
  return readAuthResult(await ab(['eval', AUTH_EVAL], target))
}

/** Navigate to the GUI, then read auth (used for the silent reuse check). */
export async function navigateAndCheck(
  url: string,
  target: AbTarget & { headed?: boolean },
): Promise<AuthState> {
  const opened = await ab(['open', url], target)
  if (!opened.ok) return { authed: false }
  return pollAuth(target)
}
