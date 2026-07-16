import type { SchemaIR, SchemaOverlay } from '../../../shared/types'

import { describeAnchor } from './anchors'

export function buildAskSystemPrompt(): string {
  return [
    'You are answering a QUICK side question from inside Domain Studio about ONE element',
    'of an Astrale domain. This is an ephemeral aside, shown in a small popover and then',
    'discarded — it is NOT part of the main build conversation.',
    '- Answer directly and concisely (usually 1–4 sentences). Lead with the answer.',
    '- You have the same local tool surface and permission mode as the main agent. You may',
    '  inspect files, run commands, use web/search tools if available, and edit files when',
    '  the user explicitly asks for a change. Keep any edits tightly scoped and say what changed.',
    '- No preamble, no machine-state/JSON block, no thread protocol — just the answer.',
  ].join('\n')
}

export interface AskParts {
  anchorRef: string
  excerpt: string
  question: string
  ir: SchemaIR | null
  overlay?: SchemaOverlay
}

/** Build one focused side-question prompt. */
export function buildAskPrompt(parts: AskParts): string {
  const target = describeAnchor(parts.anchorRef, parts.ir, parts.overlay)
  const named = parts.excerpt && parts.excerpt !== parts.anchorRef ? ` (${parts.excerpt})` : ''
  const lines = [`Quick question about \`${parts.anchorRef}\`${named} in this domain.`]
  if (target) lines.push('', 'Target:', target)
  lines.push('', `Question: ${parts.question.trim()}`)
  return lines.join('\n')
}
