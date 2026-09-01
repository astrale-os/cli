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
