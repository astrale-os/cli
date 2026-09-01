/**
 * transfer.ts — what one chat hands to the next when the user switches agent.
 *
 * A Claude session id cannot be resumed by Codex, so moving between harnesses
 * cannot move the conversation; it can only move the *knowledge* of it. This
 * module distills a chat's transcript into a briefing the new tab opens with,
 * built entirely from what Studio already recorded — no extra agent call, so
 * the fork is instant and cannot fail halfway.
 *
 * The source chat is read-only here, by design: forking must leave the original
 * exactly as the user left it.
 */
import type { AgentRun } from '../../shared/types'

/** Turns beyond this are older context than a briefing usefully carries. */
const MAX_TURNS = 12
const MAX_INSTRUCTION_CHARS = 400
const MAX_REPLY_CHARS = 600
const MAX_TOUCHED_FILES = 8

function clamp(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max).trimEnd()}…` : collapsed
}

/** The agent's own last word in a turn — its reply, not its narration. */
function finalMessage(run: AgentRun): string | undefined {
  for (let index = run.events.length - 1; index >= 0; index -= 1) {
    const event = run.events[index]!
    if (event.kind === 'message' && event.text.trim()) return event.text
  }
  return undefined
}

/** Distinct tool targets, which for the write tools are the files that changed. */
function touchedTargets(runs: AgentRun[]): string[] {
  const targets = new Set<string>()
  for (const run of runs)
    for (const event of run.events)
      if (event.kind === 'tool' && event.target?.trim()) targets.add(event.target.trim())
  return [...targets].slice(0, MAX_TOUCHED_FILES)
}

/**
 * Summarize a chat's transcript for a fork onto another harness.
 *
 * Returns an empty string when there is nothing worth carrying — an untouched
 * tab forks into a plain new chat rather than one opening on an empty briefing.
 */
export function summarizeChatTranscript(input: {
  runs: AgentRun[]
  fromHarness: string
  title?: string
}): string {
  const runs = input.runs.filter((run) => run.instruction || run.events.length > 0)
  if (runs.length === 0) return ''
  const recent = runs.slice(-MAX_TURNS)
  const omitted = runs.length - recent.length

  const turns = recent.map((run, index) => {
    const reply = finalMessage(run)
    const lines = [`### Turn ${omitted + index + 1} — ${run.status}`]
    if (run.instruction) lines.push(`- Asked: ${clamp(run.instruction, MAX_INSTRUCTION_CHARS)}`)
    else if (run.targetCommentIds.length)
      lines.push(`- Asked: answer ${run.targetCommentIds.length} open comment thread(s)`)
    if (reply) lines.push(`- Answered: ${clamp(reply, MAX_REPLY_CHARS)}`)
    if (run.error) lines.push(`- Failed: ${clamp(run.error, MAX_INSTRUCTION_CHARS)}`)
    return lines.join('\n')
  })

  const touched = touchedTargets(recent)
  return [
    `## Handoff from the ${input.fromHarness} conversation${input.title ? ` — “${input.title}”` : ''}`,
    '',
    `That conversation ran ${runs.length} turn${runs.length === 1 ? '' : 's'} in this same domain.`,
    'It is still open in its own tab and was NOT modified; you are continuing the work,',
    'not that session. Its session cannot be resumed from here, so treat the summary',
    'below as your only memory of it and re-read the files it names before changing them.',
    ...(omitted > 0 ? ['', `_${omitted} earlier turn(s) omitted._`] : []),
    '',
    ...turns.flatMap((turn) => [turn, '']),
    ...(touched.length
      ? ['### Targets it worked on', '', ...touched.map((t) => `- ${t}`), '']
      : []),
  ].join('\n')
}

/** Frame the stored summary as the opening context of the forked chat's first turn. */
export function handoffPreamble(summary: string): string {
  return [
    '> Transferred conversation. You are picking up work started with another agent;',
    '> the briefing below is what it did. Everything after it is the current turn.',
    '',
    summary.trim(),
    '',
    '---',
    '',
  ].join('\n')
}
