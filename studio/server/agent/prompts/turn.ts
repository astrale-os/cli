import type {
  Comment,
  ContextItem,
  DocMeta,
  NewDomainContext,
  SchemaIR,
  SchemaOverlay,
  SchemaRevision,
} from '../../../shared/types'

import { buildCopyMarkdown, buildMachineStateBlock } from '../../handoff/copy'
import { resolveThreadAnchors } from './anchors'

/** One domain of the workspace, as a turn describes it. */
export interface DomainTurnParts {
  origin: string
  /** absolute — what the agent `cd`s into */
  root: string
  /** from the workspace root, the way the turn names it */
  relativePath: string
  renderFingerprint: string
  schemaRevision?: SchemaRevision
  /** every open thread, answered or not — the digest counts them */
  openThreads: number
  /** the threads whose last word is not the agent's — what this turn carries */
  awaitingThreads: Comment[]
  userContext: ContextItem[]
  autoContext: ContextItem[]
  documents: DocMeta[]
  ir: SchemaIR | null
  overlay?: SchemaOverlay
}

export interface TurnParts {
  workspaceRoot: string
  /** every domain in the workspace, briefed or not: the digest lists them all */
  domains: DomainTurnParts[]
  firstTurn: boolean
  message?: string
  /** present only when this first turn is the creation brief for a fresh scaffold */
  newDomain?: NewDomainContext
}

/** A domain earns a briefing when the turn carries something of it. */
export function briefedDomains(domains: DomainTurnParts[]): DomainTurnParts[] {
  return domains.filter(
    (domain) => domain.awaitingThreads.length > 0 || domain.documents.length > 0,
  )
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * The workspace at a glance: where the agent stands, and where the work waits.
 *
 * The push half of the protocol — the pull half is `list_domains`. One line per
 * domain, including the ones this turn does not brief, so the agent knows what else
 * is within reach and never has to guess a path.
 */
function workspaceDigest(parts: TurnParts): string {
  const lines = [
    '## Workspace',
    '',
    `Working directory: \`${parts.workspaceRoot}\` — ${count(parts.domains.length, 'domain')}, each its own repo. \`cd\` into a domain for its commands and read its \`.agents/skills/\` before editing it.`,
    '',
  ]
  for (const domain of parts.domains) {
    const waiting = domain.awaitingThreads.length
    const status =
      domain.openThreads === 0
        ? 'no open thread'
        : `${count(domain.openThreads, 'open thread')}, ${waiting} awaiting your reply`
    const docs =
      domain.documents.length > 0 ? `, ${count(domain.documents.length, 'document')}` : ''
    lines.push(`- **${domain.origin}** — \`${domain.relativePath}\` — ${status}${docs}`)
  }
  return lines.join('\n')
}

/** Build the handoff payload for one new or follow-up turn. */
export function buildTurnPrompt(parts: TurnParts): string {
  const briefed = briefedDomains(parts.domains)
  const awaiting = briefed.flatMap((domain) => domain.awaitingThreads)
  const hasThreads = awaiting.length > 0
  const header = parts.newDomain
    ? '> New session. Domain Studio has just scaffolded the domain below. Build it from the user’s creation brief.'
    : parts.firstTurn
      ? hasThreads
        ? '> New session. The thread pointers and context below are your orientation — implement the open threads and reply by id.'
        : '> New session. Follow the direct instruction below; use the context below and read each domain’s schema/ when needed.'
      : hasThreads
        ? '> Follow-up turn in the SAME session. The schema files are current (incl. your prior edits); the threads below were added or updated since your last reply — implement and answer them.'
        : '> Follow-up turn in the SAME session. The schema files are current (incl. your prior edits). Follow the direct instruction below.'
  const message = parts.message?.trim()
  const creation = parts.newDomain
    ? [
        '',
        '## Newly created domain',
        '',
        `- **Origin:** \`${parts.newDomain.origin}\``,
        `- **Repo:** \`${parts.newDomain.path}\``,
        '',
        `The user’s creation brief below applies specifically to this domain. Work inside \`${parts.newDomain.path}\`, load the **astrale-domain** skill first, and follow its **New Domain Creation Workflow**.`,
      ]
    : []
  const instruction = message
    ? ['', parts.newDomain ? '## User creation brief' : '## Direct instruction', '', message]
    : []
  const sections = briefed.map((domain) => {
    const anchors = resolveThreadAnchors(domain.awaitingThreads, domain.overlay)
    const body = buildCopyMarkdown({
      origin: domain.origin,
      root: domain.root,
      renderFingerprint: domain.renderFingerprint,
      schemaRevision: domain.schemaRevision,
      openComments: domain.awaitingThreads,
      userContext: domain.userContext,
      autoContext: domain.autoContext,
      documents: domain.documents,
      machineState: false,
    })
    return [anchors, '', body].filter((part) => part).join('\n')
  })
  // ONE machine-state block for the whole turn: threads are merged back by id, and an id
  // says which domain it belongs to on its own. No `schemaVersion` — that fingerprint is
  // per domain, and each domain's own header already carries it.
  const fallback = hasThreads ? ['', buildMachineStateBlock(awaiting)] : []
  return [
    header,
    ...creation,
    ...instruction,
    '',
    workspaceDigest(parts),
    '',
    ...sections,
    ...fallback,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
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
