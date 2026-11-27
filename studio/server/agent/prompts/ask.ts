import type { SchemaIR, SchemaOverlay } from '../../../shared/contracts/schema'

import { describeAnchor } from './anchors'

export function buildAskSystemPrompt(): string {
  return [
    'You are answering a QUICK side question from inside Domain Studio about ONE element',
    'of an Astrale domain. This is an ephemeral aside, shown in a small popover and then',
    'discarded — it is NOT part of the main build conversation.',
    '- Lead with the answer and stop once the question is answered.',
    '- You have the same local tool surface and permission mode as the main agent. You may',
    '  inspect files, run commands, use web/search tools if available, and edit files when',
    '  the user explicitly asks for a change. Keep any edits tightly scoped and say what changed.',
    '- No preamble, no machine-state/JSON block, no thread protocol — just the answer.',
  ].join('\n')
}

/** Where the element lives, so the answer reads the right source. */
export type AskDomain =
  /** A project of this workspace, at its path from the workspace root. */
  | { source: 'project'; origin: string; path: string }
  /** The Kernel, read from the installed SDK rather than from a project. */
  | { source: 'kernel'; origin: string }
  /** One published version, read from the registry; no project of it is at hand. */
  | { source: 'publication'; origin: string; version: string }

interface AskParts {
  anchorRef: string
  excerpt: string
  question: string
  ir: SchemaIR | null
  overlay?: SchemaOverlay
  domain?: AskDomain
  /**
   * The Domain is one the Studio only reads (`isReadOnlyDomainId`): the prompt tells the aside to
   * edit nothing of it. An instruction, not an enforcement — the fork runs at the chosen access.
   */
  readOnly?: boolean
}

function whereOf(domain: AskDomain | undefined): string {
  if (!domain) return ' in this workspace'
  switch (domain.source) {
    case 'project':
      return ` in the domain \`${domain.origin}\` (at \`${domain.path}\`)`
    case 'kernel':
      return ` in the read-only Kernel Domain \`${domain.origin}\` (as the installed \`@astrale-os/sdk\` ships it)`
    case 'publication':
      return ` in the read-only Publication \`${domain.origin}@${domain.version}\` (its Schema as the registry serves it; its sources are not in this workspace)`
  }
}

/** Build one focused side-question prompt. */
export function buildAskPrompt(parts: AskParts): string {
  const target = describeAnchor(parts.anchorRef, parts.ir, parts.overlay)
  const named = parts.excerpt && parts.excerpt !== parts.anchorRef ? ` (${parts.excerpt})` : ''
  const lines = [`Quick question about \`${parts.anchorRef}\`${named}${whereOf(parts.domain)}.`]
  if (parts.readOnly)
    lines.push('It is read here, never edited: answer from its Schema and change no file for it.')
  if (target) lines.push('', 'Target:', target)
  lines.push('', `Question: ${parts.question.trim()}`)
  return lines.join('\n')
}
