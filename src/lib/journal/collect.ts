import type { JournalInput, JournalPage, JournalRecord } from '../../commands/logs'
import type { FailureDiagnostic } from '../../connection/failure/model'

import { classifyFailure } from '../../connection/failure/classify'

/** Coverage describes this authorized journal read, never the completeness of trace sampling. */
export async function collectJournal(
  input: JournalInput,
  read: (input: JournalInput) => Promise<JournalPage>,
  options: { maxPages: number; now?: () => Date },
) {
  if (!Number.isSafeInteger(options.maxPages) || options.maxPages < 1) {
    throw new TypeError('maxPages must be a positive safe integer')
  }
  if (input.cursor && !input.until)
    throw new TypeError('Resuming requires the original until bound')
  const { cursor: initialCursor, ...filters } = input
  const selection = {
    ...filters,
    until: input.until ?? (options.now?.() ?? new Date()).toISOString(),
  }
  let cursor = initialCursor
  let frontier: JournalPage['frontier']
  const records: JournalRecord[] = []
  const seen = new Set<string>()
  const cursors = new Set<string>(cursor ? [cursor] : [])
  const gaps: unknown[] = []
  const reasons = new Set<string>()
  let error: FailureDiagnostic | undefined
  let pages = 0
  for (; pages < options.maxPages;) {
    let page: JournalPage
    try {
      page = await read({ ...selection, ...(cursor === undefined ? {} : { cursor }) })
    } catch (cause) {
      error = classifyFailure(cause)
      reasons.add('read-failed')
      break
    }
    pages++
    if (!page.frontier) reasons.add('frontier-unavailable')
    if (frontier && page.frontier && frontier.id !== page.frontier.id) {
      reasons.add('journal-generation-changed')
    }
    frontier = page.frontier ?? frontier
    if (page.gap !== undefined) {
      gaps.push(page.gap)
      reasons.add('journal-gap')
    }
    for (const record of page.records) {
      const key = `${page.frontier?.id ?? ''}:${record.sequence}`
      if (!seen.has(key)) {
        seen.add(key)
        records.push(record)
      }
    }
    cursor = page.cursor
    if (cursor === undefined) break
    if (cursors.has(cursor)) {
      reasons.add('cursor-not-advancing')
      break
    }
    cursors.add(cursor)
  }
  if (cursor !== undefined && pages >= options.maxPages) reasons.add('page-limit')
  return {
    records,
    ...(error === undefined ? {} : { error }),
    ...(frontier === undefined ? {} : { frontier }),
    ...(cursor === undefined ? {} : { cursor }),
    coverage: {
      status: reasons.size === 0 ? ('complete' as const) : ('partial' as const),
      reasons: [...reasons],
      pages,
      selection,
      gaps,
    },
  }
}
