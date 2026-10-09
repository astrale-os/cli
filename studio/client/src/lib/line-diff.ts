/**
 * line-diff.ts - what an edit changed, line by line, for showing it.
 *
 * An agent reports an edit as the text before and after (ACP's `diff` content),
 * usually one hunk with a few lines of context around the change. The shared
 * head and tail are found first - they cost nothing and are most of a hunk -
 * and only what is left between them is aligned, within a budget: past it the
 * middle reads as removed-then-added, which is still exactly what happened.
 */

export interface DiffLine {
  kind: 'same' | 'removed' | 'added'
  text: string
}

/** The largest middle (lines before × lines after) worth aligning line by line. */
const ALIGN_BUDGET = 250_000

const lines = (text: string | undefined) => (text ? text.split('\n') : [])

function align(before: string[], after: string[]): DiffLine[] {
  const width = after.length + 1
  // common[i * width + j]: the longest run of shared lines from before[i] and after[j] on
  const common = new Uint32Array((before.length + 1) * width)
  for (let i = before.length - 1; i >= 0; i -= 1)
    for (let j = after.length - 1; j >= 0; j -= 1)
      common[i * width + j] =
        before[i] === after[j]
          ? common[(i + 1) * width + j + 1]! + 1
          : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!)

  const diff: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      diff.push({ kind: 'same', text: before[i]! })
      i += 1
      j += 1
    } else if (common[(i + 1) * width + j]! >= common[i * width + j + 1]!) {
      diff.push({ kind: 'removed', text: before[i]! })
      i += 1
    } else {
      diff.push({ kind: 'added', text: after[j]! })
      j += 1
    }
  }
  for (; i < before.length; i += 1) diff.push({ kind: 'removed', text: before[i]! })
  for (; j < after.length; j += 1) diff.push({ kind: 'added', text: after[j]! })
  return diff
}

/** Every line of `before` and `after`, each marked as kept, removed or added. */
export function lineDiff(before: string | undefined, after: string): DiffLine[] {
  const a = lines(before)
  const b = lines(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail += 1

  const removed = a.slice(head, a.length - tail)
  const added = b.slice(head, b.length - tail)
  const middle =
    removed.length * added.length > ALIGN_BUDGET
      ? [
          ...removed.map((text): DiffLine => ({ kind: 'removed', text })),
          ...added.map((text): DiffLine => ({ kind: 'added', text })),
        ]
      : align(removed, added)
  const same = (text: string): DiffLine => ({ kind: 'same', text })
  return [...a.slice(0, head).map(same), ...middle, ...a.slice(a.length - tail).map(same)]
}
