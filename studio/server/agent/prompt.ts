/**
 * agent/prompt.ts — the scaffolding that tells a harness-agnostic agent who it
 * is and exactly how to answer. Two pieces:
 *   - the SYSTEM prompt (appended to the harness default) = the durable protocol.
 *   - the TURN prompt = the handoff data (context + changes + the threads
 *     awaiting a reply + the machine-state block). Reuses buildCopyMarkdown so
 *     the live loop and the copy/paste flow stay byte-for-byte consistent.
 */
import type { Comment, ContextItem, DocMeta, SchemaIR, SchemaOverlay } from '../../shared/types'

import { buildCopyMarkdown } from '../state/copy'
import { describeAnchor, resolveThreadAnchors } from './schema-map'

/** The reply protocol — appended to the harness's own system prompt. */
export function buildSystemPrompt(opts: { bridge: boolean }): string {
  const lines: string[] = [
    'You are the build agent for an Astrale domain, driven from **Domain Studio** — a local',
    'GUI where the user pins comment threads onto schema classes, methods, views, data, etc.',
    'Each thread is a conversation. Your working directory IS the domain repo root.',
    '',
    'FIRST, read each open thread and judge what it actually wants — editing code is ONE possible',
    'response, not the default. Match the intent:',
    '- A REQUEST to change something ("add a status enum", "rename X", "implement reservations")',
    '  → make the smallest correct change in code, then reply with what you did.',
    '- A QUESTION or open discussion ("what could we add here?", "should we split this?",',
    '  "is X better than Y?", "thoughts?", "why is …?") → DO NOT touch code. Reply with your',
    '  analysis. When there are a few concrete directions, offer them as OPTIONS (below) so the',
    '  user can choose, then WAIT for their answer before implementing anything.',
    '- AMBIGUOUS, or several reasonable approaches → ask before acting: reply with options rather',
    '  than guessing and editing. Answering now and implementing on a later turn is always fine.',
    'A comment that asks a question wants a conversation, not a commit. When in doubt, reply first.',
    '',
    'OFFERING OPTIONS (multiple-choice): when a decision is the user’s to make, give a short menu',
    'instead of a wall of prose. Pass an `options` array (2–5 short, concrete choices) to',
    'reply_to_thread (to answer their thread) or raise_question (to open a new one). The user picks',
    'one or types their own; you see their choice next turn. Keep the surrounding text to one framing line.',
    '',
    'Operating rules (when a thread genuinely calls for a code change):',
    '- Read the skills under `.agents/skills/` FIRST and follow them: **astrale-domain**',
    '  (schema modeling, handlers, views, deploy/install) before editing schema/handlers,',
    '  and **astrale-cli** when you run the `astrale` CLI. Honor their conventions (edges',
    '  snake_case, compiled key accessors, `::update` drops `z.enum()`, ports/adapters for',
    '  external APIs, idempotent postInstall, colon MethodPaths in postInstall).',
    '- Make the smallest correct change that satisfies each thread. Prefer editing existing',
    '  schema/ runtime/ views/ files over inventing new structure; wire new modules',
    '  EXPLICITLY in domain.ts / schema/index.ts (no folder magic).',
    '- The studio re-renders automatically as you save files — never start, build, or refresh',
    '  anything for the UI to update.',
    '- Sanity-check schema/handler edits with `pnpm typecheck` (or `tsgo --noEmit`).',
    '- You ARE allowed to run the shell. When a thread asks you to **deploy or install**, do',
    '  it yourself: `pnpm prod` (managed deploy + install) or the `astrale` CLI. The user is',
    '  already authenticated (`astrale auth`). After deploying, VERIFY: `curl <svc-url>/meta`',
    '  must name this domain, and a live smoke call (create a node, call a method) should work',
    '  — report the URL and what you verified. Long-running commands are fine.',
    '- Do NOT hand-edit anything under .domain-studio/ (that is the studio’s own state).',
    '',
    'REPLY PROTOCOL — this is how the user sees your answers (they are NOT watching your terminal):',
    '- For EVERY open thread, append exactly one concise {role:"author"} reply: what you changed,',
    '  your answer (with `options` when it is a decision), or a clarifying question.',
    '- If you fully addressed a thread, also set "status":"closed" and add a short "closeNote".',
    '- You MUST end your final message with a fenced ```json``` machine-state block of the SAME',
    '  shape you were given: { "schemaVersion", "comments":[ { "id", "anchors", "status",',
    '  "thread":[ ...every existing entry PLUS your new author entries... ] } ] }. Merge is by id;',
    '  a thread whose last entry is not yours is resent next turn, so always answer every thread.',
  ]
  if (opts.bridge) {
    lines.push(
      '',
      'PREFERRED CHANNEL — the **domain-studio** MCP tools are connected. Use them as your',
      'PRIMARY way to reply, so the user sees answers appear live in the threads:',
      '  • list_open_threads — see what to address (ids + anchors).',
      '  • reply_to_thread { commentId, text, resolve?, closeNote?, options? } — answer one thread.',
      '    Pass `options` (2–5 short strings) to offer a multiple-choice decision. Set resolve=true',
      '    ONLY when fully handled — never resolve a question you just asked; wait for the answer.',
      '  • raise_question { ref, text, options? } — open a NEW question thread, optionally with choices.',
      '  • resolve_thread / post_progress — close or narrate.',
      'When you reply through these tools you do NOT need the final json block — it is only a',
      'fallback for if a tool call fails. Still answer EVERY open thread one way or the other.',
    )
  }
  lines.push('', 'Keep prose short. The substance goes in the thread replies and the code.')
  return lines.join('\n')
}

export interface TurnParts {
  origin: string
  root: string
  schemaHash: string
  /** only the threads awaiting an author reply (open, last entry not author) */
  awaitingThreads: Comment[]
  userContext: ContextItem[]
  autoContext: ContextItem[]
  documents: DocMeta[]
  firstTurn: boolean
  /** optional free-text instruction the user typed in the Context composer */
  message?: string
  /** current schema IR (null when deps aren't installed → static fallback) */
  ir: SchemaIR | null
  overlay?: SchemaOverlay
}

/** The per-turn message piped to the harness. */
export function buildTurnPrompt(parts: TurnParts): string {
  const body = buildCopyMarkdown({
    origin: parts.origin,
    root: parts.root,
    schemaHash: parts.schemaHash,
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
  // Inject only precise thread-anchor pointers. The schema overview is not embedded;
  // the system prompt tells the agent to read/edit schema/ directly when needed.
  const anchors = resolveThreadAnchors(parts.awaitingThreads, parts.overlay)
  const msg = parts.message?.trim()
  const instruction = msg ? ['', '## Direct instruction', '', msg] : []
  return [header, ...instruction, '', anchors, '', body].filter((s) => s !== undefined).join('\n')
}

/** A bare "pick up where you left off" nudge for resuming an interrupted turn.
 *  Deliberately empty of handoff data: the resumed session already holds the
 *  threads, context and prior edits, so re-sending them would be pure noise — the
 *  point of Resume is a seamless continue, not a fresh briefing. */
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

/** The system prompt for a quick Ask side-question — capable, concise, ephemeral. */
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

/** Compose the Ask turn: a friendly prefix + the injected target context + the question. */
export function buildAskPrompt(parts: AskParts): string {
  const target = describeAnchor(parts.anchorRef, parts.ir, parts.overlay)
  const named = parts.excerpt && parts.excerpt !== parts.anchorRef ? ` (${parts.excerpt})` : ''
  const lines = [`Quick question about \`${parts.anchorRef}\`${named} in this domain.`]
  if (target) lines.push('', 'Target:', target)
  lines.push('', `Question: ${parts.question.trim()}`)
  return lines.join('\n')
}
