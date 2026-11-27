/**
 * What changed since the last Publication and the bump it requires, judged by the platform:
 * `astrale-domain diff --json`, run with the Domain's own installed SDK in the Domain's root. The
 * Studio never approximates the judgement; it only relays it, adds the platform's reason for each
 * level, and keeps the judgement while its inputs stand.
 *
 * A judgement is content-addressed by what it reads: the installed SDK, the declared version, the
 * local Schema revision and the registry index. When the local revision is the baseline's, the
 * platform compares build digests, which this key does not address, so such a judgement is never
 * kept.
 *
 * Every report is also a look: Publish starts only from a fresh look taken at the very version and
 * revision it would publish.
 */
import { createHash, randomUUID } from 'node:crypto'

import type { SchemaRevision } from '../../../shared/contracts/schema'
import type {
  Bump,
  ChangeReason,
  ChangeReport,
  PublicationChange,
  RegistryIndex,
  Remote,
  RemoteFailure,
} from '../../../shared/contracts/versions'
import type { DomainHandle } from '../../domain/registry'
import type { VersionsContext } from './context'
import type { RegistryReader } from './registry'

import { REGISTRY_STEP_LIMITS_MS } from '../../../shared/contracts/versions'
import { asBoolean, asJsonArray, asJsonRecord, asString, parseJson } from '../../json'
import { statusOfRefusal } from './failure'
import { readSources } from './local'
import { markedMessages } from './marks'
import { baselineOf } from './relation'
import { astraleDomainCommand, installedSdkVersion } from './sdk'

/** How long a look stands for Publish. */
export const LOOK_TTL_MS = 15 * 60_000
const DIFF_TIMEOUT_MS = REGISTRY_STEP_LIMITS_MS.judgement
const LOOKS_KEPT = 64
const JUDGEMENTS_KEPT = 64

/** A change report taken at a Domain's sources: what Publish requires before it starts. */
export interface Look {
  id: string
  domainId: string
  declared: string
  revision: SchemaRevision
  accepted: boolean
  published: boolean
  takenAt: number
}

export interface ChangeJudge {
  /** The platform's report for the Domain's sources now; `fresh` reads the registry again. */
  report(handle: DomainHandle, options?: { fresh?: boolean }): Promise<Remote<ChangeReport>>
  look(id: string): Look | undefined
  /** A look is spent by the Publish it starts. */
  spend(id: string): void
  /** Drop every judgement and look of a Domain, after its Publish. */
  forget(domainId: string): void
}

type Judgement = Omit<ChangeReport, 'look'>

export function createChangeJudge(context: VersionsContext, registry: RegistryReader): ChangeJudge {
  const looks = new Map<string, Look>()
  const judgements = new Map<string, { domainId: string; judgement: Judgement }>()
  const running = new Map<string, Promise<Remote<ChangeReport>>>()
  const readAt = () => new Date(context.now()).toISOString()

  function failed(message: string): RemoteFailure {
    return { status: 'failed', message, readAt: readAt() }
  }

  function take(domainId: string, judgement: Judgement): ChangeReport {
    const now = context.now()
    for (const [id, look] of looks) if (now - look.takenAt >= LOOK_TTL_MS) looks.delete(id)
    const look: Look = {
      id: randomUUID(),
      domainId,
      declared: judgement.declared,
      revision: judgement.revision,
      accepted: judgement.accepted,
      published: judgement.published,
      takenAt: now,
    }
    keep(looks, look.id, look, LOOKS_KEPT)
    return { look: look.id, ...judgement }
  }

  async function judge(handle: DomainHandle, fresh: boolean): Promise<Remote<ChangeReport>> {
    const before = await readSources(context, handle)
    const { origin, declared, revision } = before
    if (revision === null || origin === null) {
      return failed(before.revisionError ?? 'The local Schema revision is unknown.')
    }
    if (declared === null) return failed('package.json declares no version.')
    const command = astraleDomainCommand(handle.root)
    if (command === null) {
      return failed('astrale-domain is not installed for this Domain: install its dependencies.')
    }

    const index = await registry.index(origin, { fresh })
    const key = judgementKey(installedSdkVersion(handle.root), declared, revision, index)
    const held = key === undefined ? undefined : judgements.get(key)
    if (held)
      return {
        status: 'ok',
        value: take(handle.id, held.judgement),
        readAt: held.judgement.judgedAt,
      }

    const run = await context.run([command, 'diff', '--json'], {
      cwd: handle.root,
      timeoutMs: DIFF_TIMEOUT_MS,
    })
    const judgedAt = readAt()
    const messages = markedMessages(run.stderr)
    const report = decodeDiffReport(parseJson(run.stdout.trim()))
    if (report === undefined) return diffFailure(run, messages, judgedAt)
    if (report.origin !== origin || report.declared !== declared) {
      return failed(
        `astrale-domain diff judged ${report.origin} ${report.declared}, not ${origin} ${declared}: look again.`,
      )
    }
    const after = await readSources(context, handle)
    if (after.revision !== revision || after.declared !== declared) {
      return failed("The Domain's sources changed while the platform judged them: look again.")
    }

    const judgement: Judgement = {
      ...report,
      revision,
      judgedAt,
      notes: messages.map((message) => message.message),
    }
    if (key !== undefined)
      keep(judgements, key, { domainId: handle.id, judgement }, JUDGEMENTS_KEPT)
    return { status: 'ok', value: take(handle.id, judgement), readAt: judgedAt }
  }

  return {
    report(handle, options = {}) {
      const joined = running.get(handle.id)
      if (joined) return joined
      const answer = judge(handle, options.fresh === true).finally(() => {
        if (running.get(handle.id) === answer) running.delete(handle.id)
      })
      running.set(handle.id, answer)
      return answer
    },
    look: (id) => looks.get(id),
    spend(id) {
      looks.delete(id)
    },
    forget(domainId) {
      for (const [key, held] of judgements) if (held.domainId === domainId) judgements.delete(key)
      for (const [id, look] of looks) if (look.domainId === domainId) looks.delete(id)
    },
  }
}

/** Insert, then drop the oldest entries beyond `limit`. */
function keep<V>(map: Map<string, V>, key: string, value: V, limit: number): void {
  map.delete(key)
  map.set(key, value)
  for (const oldest of map.keys()) {
    if (map.size <= limit) break
    map.delete(oldest)
  }
}

/**
 * The inputs a judgement reads, or undefined when they are not all content-addressed: an unknown
 * SDK, an unreadable index, or a baseline whose revision is the local one (build digests decide).
 */
export function judgementKey(
  sdk: string | null,
  declared: string,
  revision: SchemaRevision,
  index: Remote<RegistryIndex>,
): string | undefined {
  if (sdk === null) return undefined
  let registry: unknown
  if (index.status === 'not-found') registry = 'unregistered'
  else if (index.status !== 'ok') return undefined
  else {
    if (baselineOf(index.value, declared)?.schemaRevision === revision) return undefined
    registry = index.value.publications.map((publication) => [
      publication.version,
      publication.schemaRevision,
      publication.yanked,
    ])
  }
  return createHash('sha256')
    .update(JSON.stringify([sdk, declared, revision, registry]))
    .digest('hex')
}

/** Why `astrale-domain diff` produced no report, from what it composed for its caller. */
function diffFailure(
  run: { exitCode: number; timedOut: boolean; spawnError?: string },
  messages: Array<{ tone: string; message: string }>,
  readAt: string,
): RemoteFailure {
  if (run.spawnError !== undefined) {
    return {
      status: 'failed',
      message: `astrale-domain diff could not start: ${run.spawnError}`,
      readAt,
    }
  }
  if (run.timedOut) {
    return {
      status: 'failed',
      message: `astrale-domain diff gave no answer in ${DIFF_TIMEOUT_MS / 1000} s.`,
      readAt,
    }
  }
  const refusals = messages.filter((message) => message.tone === 'refusal')
  for (const { message } of refusals) {
    // The platform names a registry failure by the CLI's code: `Domain registry: CODE: message`.
    const registry = /^Domain registry: ([A-Z][A-Z0-9_]*): ([\s\S]+)$/.exec(message)
    if (registry) {
      const [, code, text] = registry as unknown as [string, string, string]
      return { status: statusOfRefusal({ code, message: text }), code, message: text, readAt }
    }
  }
  if (refusals.length > 0) {
    return { status: 'failed', message: refusals.map(({ message }) => message).join('\n'), readAt }
  }
  return {
    status: 'failed',
    message: `astrale-domain diff answered no report (exit ${run.exitCode}).`,
    readAt,
  }
}

const BUMPS = new Set<Bump>(['patch', 'minor', 'major'])
const STATES = new Set<PublicationChange['state']>(['missing', 'changed', 'added'])

function asBump(value: unknown): Bump | undefined {
  return BUMPS.has(value as Bump) ? (value as Bump) : undefined
}

/** The platform's reason for a change's level (`requiredBump`). */
export function reasonOf(change: Pick<PublicationChange, 'facet' | 'bump'>): ChangeReason {
  if (change.facet === 'build') return 'code-only'
  if (change.facet === 'schema') return 'equivalent-schema'
  if (change.bump === 'major') return 'unsatisfied-requirement'
  if (change.bump === 'minor') return 'addition'
  return 'other-change'
}

type DiffReport = Omit<ChangeReport, 'look' | 'revision' | 'judgedAt' | 'notes'>

/** `DiffReportV1`, whole or not at all. */
export function decodeDiffReport(value: unknown): DiffReport | undefined {
  const document = asJsonRecord(value)
  const origin = asString(document?.origin)
  const declared = asString(document?.declared)
  const published = asBoolean(document?.published)
  const accepted = asBoolean(document?.accepted)
  const registry = document?.registry
  const entries = asJsonArray(document?.changes)
  if (
    document?.format !== 'astrale.diff-report' ||
    document.version !== 1 ||
    origin === undefined ||
    declared === undefined ||
    published === undefined ||
    accepted === undefined ||
    (registry !== 'read' && registry !== 'unregistered') ||
    entries === undefined
  ) {
    return undefined
  }
  const optional: Partial<Pick<DiffReport, 'baseline' | 'minimum' | 'next' | 'suggestion'>> = {}
  for (const field of ['baseline', 'minimum', 'next', 'suggestion'] as const) {
    const text = document[field]
    if (text === undefined) continue
    if (typeof text !== 'string') return undefined
    optional[field] = text
  }
  const levels: Partial<Pick<DiffReport, 'level' | 'effective'>> = {}
  for (const field of ['level', 'effective'] as const) {
    if (document[field] === undefined) continue
    const bump = asBump(document[field])
    if (bump === undefined) return undefined
    levels[field] = bump
  }
  const changes: PublicationChange[] = []
  for (const entry of entries) {
    const change = asJsonRecord(entry)
    const subject = asString(change?.subject)
    const facet = asString(change?.facet)
    const state = change?.state as PublicationChange['state']
    const bump = asBump(change?.bump)
    const detail = change?.detail
    if (
      subject === undefined ||
      facet === undefined ||
      !STATES.has(state) ||
      bump === undefined ||
      (detail !== undefined && typeof detail !== 'string')
    ) {
      return undefined
    }
    changes.push({
      subject,
      facet,
      state,
      bump,
      reason: reasonOf({ facet, bump }),
      ...(detail === undefined ? {} : { detail }),
    })
  }
  return { origin, declared, published, registry, ...optional, ...levels, accepted, changes }
}
