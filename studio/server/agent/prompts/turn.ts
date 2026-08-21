import type {
  Comment,
  ContextItem,
  DocMeta,
  SchemaIR,
  SchemaOverlay,
  SchemaRevision,
} from '../../../shared/types'

import { buildCopyMarkdown } from '../../handoff/copy'
import { resolveThreadAnchors } from './anchors'

export interface TurnParts {
  origin: string
  root: string
  renderFingerprint: string
  schemaRevision?: SchemaRevision
  awaitingThreads: Comment[]
  userContext: ContextItem[]
  autoContext: ContextItem[]
  documents: DocMeta[]
  firstTurn: boolean
  message?: string
  ir: SchemaIR | null
  overlay?: SchemaOverlay
}

/** Build the handoff payload for one new or follow-up turn. */
export function buildTurnPrompt(parts: TurnParts): string {
  const body = buildCopyMarkdown({
    origin: parts.origin,
    root: parts.root,
    renderFingerprint: parts.renderFingerprint,
    schemaRevision: parts.schemaRevision,
    openComments: parts.awaitingThreads,
    userContext: parts.userContext,
    autoContext: parts.autoContext,
    documents: parts.documents,
  })
  const hasThreads = parts.awaitingThreads.length > 0
  const header = parts.firstTurn
    ? hasThreads
      ? '> New session. The thread pointers and context below are your orientation — implement the open threads and reply by id.'
      : '> New session. Follow the direct instruction below; use the context below and read schema/ when needed.'
    : hasThreads
      ? '> Follow-up turn in the SAME session. The schema files are current (incl. your prior edits); the threads below were added or updated since your last reply — implement and answer them.'
      : '> Follow-up turn in the SAME session. The schema files are current (incl. your prior edits). Follow the direct instruction below.'
  const anchors = resolveThreadAnchors(parts.awaitingThreads, parts.overlay)
  const message = parts.message?.trim()
  const instruction = message ? ['', '## Direct instruction', '', message] : []
  return [header, ...instruction, '', anchors, '', body]
    .filter((part) => part !== undefined)
    .join('\n')
}

/** Build the minimal nudge for a surviving interrupted conversation. */
export function buildResumePrompt(): string {
  return [
    '> Resuming the SAME session. Your previous turn was cut off when Domain Studio',
    '> restarted — nothing else has changed. Pick up exactly where you left off.',
    '',
    'Continue and finish what you were doing, then make sure every open thread gets an',
    'answer through the usual channel (the domain-studio MCP tools, or the final',
    'machine-state ```json``` block). Keep going from where you stopped — do not restart.',
  ].join('\n')
}
