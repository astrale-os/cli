/**
 * harnesses.ts — naming the local agents in the UI.
 *
 * `HarnessStatus.options` is the server's own list, so it stays right when a
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
  return harness?.options?.length ? harness.options : FALLBACK
}

export function labelOf(harness: HarnessStatus | undefined, id: string): string {
  return harnessOptions(harness).find((option) => option.id === id)?.label ?? id
}
