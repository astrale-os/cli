/**
 * handoff.ts — shared helpers that turn live domain state into the "what changed
 * + what to read" material both the Copy payload (api.ts) and the live agent
 * runner depend on. Extracted so there is ONE definition of the change text and
 * the auto-context refresh.
 */
import type { ChangeSet } from '../../shared/types'
import type { DomainHandle } from '../domain'

import { getBundle } from '../cache'
import { computeChanges, hashAnatomyFiles } from './baseline'
import { readComments } from './comments'
import { materializeAuto } from './context'

/** Current changes vs the review baseline (schema IR diff + anatomy file diff). */
export async function changeSet(handle: DomainHandle): Promise<ChangeSet> {
  const bundle = await getBundle(handle.id)
  const files = hashAnatomyFiles(handle.root, handle.schemaDirName)
  return computeChanges(handle.root, bundle?.ir ?? null, files, {
    schemaDirName: handle.schemaDirName,
  })
}

/** A human-readable "current changes" blob for the handoff payload. */
export function changeText(cs: ChangeSet): string {
  if (cs.schemaDiffText && cs.schemaDiffText.trim()) return cs.schemaDiffText.trim()
  const lines: string[] = []
  for (const c of cs.schemaChanges)
    lines.push(
      `${c.breaking ? '! ' : '+ '}${c.kind} ${c.target}${c.detail ? ` (${c.detail})` : ''}`,
    )
  for (const f of cs.fileChanges) lines.push(`~ ${f.status} ${f.file}`)
  return lines.join('\n')
}

/** Refresh the on-disk context/auto digests so an external agent can read them. */
export async function refreshAuto(handle: DomainHandle): Promise<void> {
  const cs = await changeSet(handle)
  const store = readComments(handle.root)
  const open = store.comments.filter((c) => c.status === 'open')
  const commentsDigest = open
    .map(
      (c, i) =>
        `${i + 1}. [${c.kind} ${c.id}] ${c.anchorRefs[0]?.ref ?? ''} — ${c.thread.at(-1)?.text ?? ''}`,
    )
    .join('\n')
  const schemaSummary = cs.schemaChanges
    .map((c) => `${c.breaking ? 'BREAKING ' : ''}${c.kind} ${c.target}`)
    .join('\n')
  materializeAuto(handle.root, {
    changes: changeText(cs) || 'no tracked changes',
    schemaChange: schemaSummary || 'no schema changes since baseline',
    comments: commentsDigest || 'no open comments',
  })
}
