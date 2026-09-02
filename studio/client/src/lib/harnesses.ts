/**
 * harnesses.ts — naming the local agents in the UI.
 *
 * `HarnessStatus.harnesses` is the server's own list, so it stays right when a
 * harness is added or renamed. The fallback only covers the moment before that
 * query lands: a tab strip that briefly says "codex" instead of "Codex" reads
 * as a bug.
 */
import type { HarnessStatus } from '@shared/types'

const FALLBACK: { id: string; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
]

export function harnessOptions(harness?: HarnessStatus): { id: string; label: string }[] {
  return harness?.harnesses?.length
    ? harness.harnesses.map(({ id, label }) => ({ id, label }))
    : FALLBACK
}

export function labelOf(harness: HarnessStatus | undefined, id: string): string {
  return harnessOptions(harness).find((option) => option.id === id)?.label ?? id
}

/**
 * One harness exactly as the last probe found it — `ok`, and the reason behind
 * it. The composer needs the reason: "unavailable" alone is what sent people
 * looking for a fault in the studio when the answer was in the probe all along.
 */
export function presenceOf(
  harness: HarnessStatus | undefined,
  id: string,
): HarnessStatus['harnesses'][number] | undefined {
  return harness?.harnesses?.find((entry) => entry.id === id)
}

/**
 * What to say when NO local agent answered — in the two lengths the UI has room for.
 *
 * `presenceOf(...).message` answers why ONE harness failed, which is the right
 * answer while another one still works. When none does, that reading breaks down:
 * the composer names whichever agent it happened to select, the reader takes it
 * for a fault in that agent, and nothing on screen says the machine simply has no
 * coding agent installed.
 *
 * `full` is that said outright, with what to do about it. `line` is the same
 * answer for the one place with a single line to spend — the dock's resting bar,
 * which is often the whole of what someone arriving on Studio sees. Both name the
 * agents from the server's own list, so neither goes stale when one is added.
 *
 * `undefined` until the probes have answered — a studio still asking must not
 * flash "no agent" at someone who has one.
 */
export function noAgentNotice(harness?: HarnessStatus): { line: string; full: string } | undefined {
  const known = harness?.harnesses ?? []
  if (!known.length || known.some((entry) => entry.ok)) return undefined
  const names = known.map((entry) => entry.label)
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0]
  return {
    line: `No coding agent found — install ${list}`,
    full: `No coding agent found on this machine. Studio runs the one you already have — install ${list}, make sure it is on your PATH, and reload.`,
  }
}
