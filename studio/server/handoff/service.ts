/**
 * Handoff service that turns live domain state into the "what changed
 * + what to read" material the live agent runner depends on. It keeps one
 * definition of the change text and the auto-context refresh.
 */
import type { ChangeSet } from '../../shared/contracts/workspace'
import type { DomainHandle } from '../domain/registry'

import { getBundle } from '../introspect/cache'
import {
  computeChanges,
  currentSchemaOf,
  hashAnatomyFiles,
  schemaComparisonText,
  seedBaseline,
} from '../state/baseline'
import { briefedComments } from '../state/comments'
import { materializeAuto } from '../state/context'
import { detectGit, gitDiff } from '../workspace/git'

/**
 * Current changes vs the review baseline (schema IR diff + anatomy file diff). A Domain whose
 * boot extraction failed has no baseline yet; its first bundle with a Schema seeds it here.
 */
async function changeSet(handle: DomainHandle): Promise<ChangeSet> {
  const bundle = await getBundle(handle.id)
  seedBaseline(handle, bundle)
  const files = hashAnatomyFiles(handle.root, handle.schemaDirName, handle.domainFile)
  const { hasGit } = detectGit(handle.root)
  const diffText = hasGit ? await gitDiff(handle.root, handle.schemaDirName) : null
  return computeChanges(handle.root, currentSchemaOf(bundle), files, {
    git: {
      hasGit,
      ...(diffText === null ? {} : { diffText }),
    },
  })
}

/**
 * A human-readable "current changes" blob for the handoff payload: that the Schema cannot be read
 * and why, the Git diff (or else each Schema change), and each anatomy file changed.
 */
export function changeText(cs: ChangeSet): string {
  const notice =
    'Indicative source/structure diff only; the Kernel Runtime has not assessed installation or data migration.'
  const lines: string[] = []
  if (cs.schema.state === 'unread') lines.push(schemaComparisonText(cs.schema))
  const gitDiff = cs.source === 'git' ? cs.schemaDiffText?.trim() : undefined
  if (gitDiff) lines.push(gitDiff)
  else if (cs.schema.state === 'changed')
    for (const c of cs.schema.changes)
      lines.push(`~ ${c.kind} ${c.target}${c.detail ? ` (${c.detail})` : ''}`)
  for (const f of cs.fileChanges) lines.push(`~ ${f.status} ${f.file}`)
  return lines.length > 0 ? `${notice}\n${lines.join('\n')}` : ''
}

/** The "Schema changes" digest: what changed, that nothing did, or that the Schema cannot be read and why. */
export function schemaChangeDigest(cs: ChangeSet): string {
  switch (cs.schema.state) {
    case 'unchanged':
      return 'no schema changes since baseline'
    case 'unread':
      return schemaComparisonText(cs.schema)
    case 'changed':
      return `Indicative only; Runtime compatibility was not assessed.\n${cs.schema.changes
        .map((c) => `STRUCTURAL ${c.kind} ${c.target}`)
        .join('\n')}`
  }
}

/** Refresh the on-disk context/auto digests so an external agent can read them. */
export async function refreshAuto(handle: DomainHandle): Promise<void> {
  const cs = await changeSet(handle)
  const store = briefedComments(handle.root)
  const open = store.comments.filter((c) => c.status === 'open')
  const commentsDigest = open
    .map(
      (c, i) =>
        `${i + 1}. [${c.kind} ${c.id}] ${c.anchorRefs[0]?.ref ?? ''} — ${c.thread.at(-1)?.text ?? ''}`,
    )
    .join('\n')
  materializeAuto(handle.root, {
    changes: changeText(cs) || 'no tracked changes',
    schemaChange: schemaChangeDigest(cs),
    comments: store.unreadable ?? (commentsDigest || 'no open comments'),
  })
}
