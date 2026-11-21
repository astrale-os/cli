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

interface AskParts {
  anchorRef: string
  excerpt: string
  question: string
  ir: SchemaIR | null
  overlay?: SchemaOverlay
  /**
   * The domain the element lives in, so the answer reads the right repo. The Kernel has no
   * path: it is read from the installed SDK, not from a project in the workspace.
   */
  domain?: { origin: string; path?: string }
}

/** Build one focused side-question prompt. */
export function buildAskPrompt(parts: AskParts): string {
  const target = describeAnchor(parts.anchorRef, parts.ir, parts.overlay)
  const named = parts.excerpt && parts.excerpt !== parts.anchorRef ? ` (${parts.excerpt})` : ''
  const where = !parts.domain
    ? ' in this workspace'
    : parts.domain.path === undefined
      ? ` in the read-only Kernel Domain \`${parts.domain.origin}\` (as the installed \`@astrale-os/sdk\` ships it)`
      : ` in the domain \`${parts.domain.origin}\` (at \`${parts.domain.path}\`)`
  const lines = [`Quick question about \`${parts.anchorRef}\`${named}${where}.`]
  if (target) lines.push('', 'Target:', target)
  lines.push('', `Question: ${parts.question.trim()}`)
  return lines.join('\n')
}
