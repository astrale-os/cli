/**
 * Handoff service that turns live domain state into the "what changed
 * + what to read" material the live agent runner depends on. It keeps one
 * definition of the change text and the auto-context refresh.
 */
import type { ChangeSet } from '../../shared/types'
import type { DomainHandle } from '../domain'

import { getBundle } from '../cache'
import { computeChanges, hashAnatomyFiles } from '../state/baseline'
import { readComments } from '../state/comments'
import { materializeAuto } from '../state/context'
import { detectGit, gitDiff } from '../workspace/git'

/** Current changes vs the review baseline (schema IR diff + anatomy file diff). */
export async function changeSet(handle: DomainHandle): Promise<ChangeSet> {
  const bundle = await getBundle(handle.id)
  const files = hashAnatomyFiles(handle.root, handle.schemaDirName, handle.applicationFile)
  const { hasGit } = detectGit(handle.root)
  const diffText = hasGit ? gitDiff(handle.root, handle.schemaDirName) : null
  return computeChanges(handle.root, bundle?.ir ?? null, files, {
    currentRevision: bundle?.schemaRevision ?? null,
    git: {
      hasGit,
      ...(diffText === null ? {} : { diffText }),
    },
  })
}

/** A human-readable "current changes" blob for the handoff payload. */
export function changeText(cs: ChangeSet): string {
  const notice =
    'Indicative source/structure diff only; the Kernel Runtime has not assessed installation or data migration.'
  if (cs.schemaDiffText && cs.schemaDiffText.trim()) return `${notice}\n${cs.schemaDiffText.trim()}`
  const lines: string[] = []
  for (const c of cs.schemaChanges)
    lines.push(`~ ${c.kind} ${c.target}${c.detail ? ` (${c.detail})` : ''}`)
  for (const f of cs.fileChanges) lines.push(`~ ${f.status} ${f.file}`)
  return lines.length > 0 ? `${notice}\n${lines.join('\n')}` : ''
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
  const schemaSummary = cs.schemaChanges.map((c) => `STRUCTURAL ${c.kind} ${c.target}`).join('\n')
  materializeAuto(handle.root, {
    changes: changeText(cs) || 'no tracked changes',
    schemaChange: schemaSummary
      ? `Indicative only; Runtime compatibility was not assessed.\n${schemaSummary}`
      : 'no schema changes since baseline',
    comments: commentsDigest || 'no open comments',
  })
}
