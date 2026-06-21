/**
 * state/updates.ts — the "is anything stale?" bridge for the header Update badge.
 *
 * We don't reimplement staleness: the `astrale` CLI owns it. `astrale update
 * --check --json`, run in the DOMAIN ROOT (so its @astrale-os/* SDK-dep axis sees
 * THIS project), emits a unified `{ stale, cli, sdk }` report. We run it with
 * stdout piped and read it regardless of exit code — a stale result exits 10 by
 * design, which is not an error here. Best-effort: anything unexpected (no
 * `astrale` on PATH, bad output) collapses to "nothing stale" so the badge stays
 * hidden rather than nagging on a hiccup.
 */
import type { StaleReport } from '../../shared/types'

const NOT_STALE: StaleReport = {
  stale: false,
  cli: { stale: false, managed: true },
  sdk: { stale: false, inProject: false, outdated: [] },
}

export async function getUpdates(root: string): Promise<StaleReport> {
  try {
    const proc = Bun.spawn(['astrale', 'update', '--check', '--json'], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited // exit 10 = "stale" (expected); we already have stdout
    const parsed = JSON.parse(out) as StaleReport
    return typeof parsed?.stale === 'boolean' ? parsed : NOT_STALE
  } catch {
    return NOT_STALE
  }
}

export interface UpdateApplyResult {
  ok: boolean
  output: string
}

/**
 * Apply the update for the header "Update now" button — `astrale update --yes`,
 * run in the domain root. The CLI does the work non-interactively and resiliently
 * (binary + skills + SDK deps; a binary that can't self-update warns but doesn't
 * block the others), so we just spawn it and capture the combined output to show.
 */
export async function applyUpdates(root: string): Promise<UpdateApplyResult> {
  try {
    const proc = Bun.spawn(['astrale', 'update', '--yes'], {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    return { ok: code === 0, output: (out + err).trim() }
  } catch (e) {
    return { ok: false, output: String(e) }
  }
}
