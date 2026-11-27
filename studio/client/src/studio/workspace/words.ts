/**
 * The Workspace level's sentences: where a Domain stands against its Publications, what changed
 * since the last one and why each change costs its bump, what a dependency version still
 * satisfies, and why a remote fact is not known. Pure: every function reads only the server's
 * answer it is given, so each sentence restates the platform's judgement and never makes one.
 */

import type {
  Bump,
  ChangeReason,
  ChangeReport,
  CompatibilityVerdict,
  DeclaredEnvironments,
  DependencyCompatibility,
  DependencyStanding,
  GitState,
  ObservedValue,
  PublicationChange,
  PublicationRelation,
  RemoteFailure,
  UnsatisfiedAssessment,
} from '@shared/contracts/versions'

import type { DomainFacts } from './facts'

import { withArticle } from '../inspector/words'

// ─── Names ───────────────────────────────────────────────────────────────────

/** `shell` for `shell.astrale.ai`. */
export function originShort(origin: string): string {
  return origin.split('.')[0] || origin
}

/** A Domain's name as a card reads it: `Issues` for `issues.astrale.ai`. */
export function domainName(origin: string): string {
  const short = originShort(origin)
  return short.charAt(0).toUpperCase() + short.slice(1)
}

/** `sha256:ce5f0919…` → `ce5f0919`: enough to tell revisions apart in a sentence. */
export function shortRevision(revision: string): string {
  const hex = revision.startsWith('sha256:') ? revision.slice('sha256:'.length) : revision
  return hex.slice(0, 8)
}

/** `a, b and c`, or `a, b or c`. */
export function joined(items: readonly string[], last: 'and' | 'or' = 'and'): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`
}

/** `1 change`, `3 changes`. */
export function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** What a Schema Key names, as a sentence says it. */
export interface KeyWords {
  /** `property`, `method`, `Class`, `function`, `Policy`, `View`, `core Node`, or empty */
  noun: string
  name: string
  /** the Class a property or method belongs to */
  of?: string
  /** the Key's origin, when it has one */
  origin?: string
}

/**
 * A Key (`shell.astrale.ai:class.Group.property.directory`) in words. A subject that is no Key —
 * a Domain's origin, for a change of its whole build or Schema — is named as it is.
 */
export function keyWords(key: string): KeyWords {
  const colon = key.indexOf(':')
  if (colon < 0) return { noun: '', name: key }
  const origin = key.slice(0, colon)
  const path = key.slice(colon + 1)
  const member = /^class\.([^.]+)\.(property|method)\.(.+)$/.exec(path)
  if (member) return { noun: member[2]!, name: member[3]!, of: member[1]!, origin }
  const top = /^(class|function|policy|view|core|integration)\.(.+)$/.exec(path)
  if (top) {
    const noun =
      top[1] === 'class'
        ? 'Class'
        : top[1] === 'policy'
          ? 'Policy'
          : top[1] === 'view'
            ? 'View'
            : top[1] === 'core'
              ? 'core Node'
              : top[1] === 'integration'
                ? 'Integration'
                : 'function'
    return { noun, name: top[2]!, origin }
  }
  return { noun: '', name: path, origin }
}

/**
 * A Key as plain text: `property directory of Group (shell)`. The origin is said only when it is
 * not `home`, the Domain the sentence is about.
 */
export function keyText(key: string, home?: string): string {
  const words = keyWords(key)
  const elsewhere = words.origin !== undefined && words.origin !== home
  const owner = words.of === undefined ? '' : ` of ${words.of}`
  const where = elsewhere ? ` (${originShort(words.origin!)})` : ''
  return `${words.noun ? `${words.noun} ` : ''}${words.name}${owner}${where}`
}

/** A sentence's first word capitalised. */
export function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ─── Remote facts ────────────────────────────────────────────────────────────

/** What ends a refusal whose cause lies outside every Domain, in the words of the button that reads again. */
const SESSION_REMEDY = {
  'signed-out': 'Sign in with the astrale CLI, then read again.',
  offline: 'Check the connection, then read again.',
} as const

export interface FailureWords {
  /** what happened, as a sentence */
  headline: string
  /** what to do about it */
  remedy: string
}

/**
 * Why a remote fact is not known. `what` names the fact, as in "the Publications of
 * shell.astrale.ai"; the CLI's own message is shown beside these words, never replaced by them.
 */
export function failureWords(failure: Pick<RemoteFailure, 'status'>, what: string): FailureWords {
  switch (failure.status) {
    case 'signed-out':
      return {
        headline: `Signed out: this Studio's astrale session cannot read ${what}.`,
        remedy: SESSION_REMEDY['signed-out'],
      }
    case 'offline':
      return {
        headline: `The registry could not be reached for ${what}.`,
        remedy: SESSION_REMEDY.offline,
      }
    case 'not-found':
      return {
        headline: `The registry has nothing readable for ${what}.`,
        remedy: 'It is absent, or this session may not read it.',
      }
    case 'refused':
      return {
        headline: `The registry refused to answer ${what}.`,
        remedy: 'Its reason is below.',
      }
    case 'failed':
      return {
        headline: `No usable answer for ${what}.`,
        remedy: 'The reason is below; read again once it is fixed.',
      }
  }
}

// ─── Standing ────────────────────────────────────────────────────────────────

/** A relation in a few words, as a card's badge reads it. */
export function relationLabel(relation: PublicationRelation): string {
  switch (relation.kind) {
    case 'never-published':
      return 'never published'
    case 'same-revision':
      return `same revision as ${relation.latest}`
    case 'ahead':
      return `ahead of ${relation.latest}`
    case 'version-taken':
      return 'version taken'
    case 'behind':
      return `behind ${relation.latest}`
    case 'undetermined':
      return "can't tell"
  }
}

/** Whether a relation asks the author to act before publishing. */
export function relationNeedsAction(relation: PublicationRelation): boolean {
  return relation.kind === 'version-taken' || relation.kind === 'behind'
}

/** Where a Domain stands against its Publications, as a sentence. */
export function relationSentence(
  relation: PublicationRelation,
  facts: { origin: string | null; declared: string | null },
): string {
  const declared = facts.declared ?? 'its version'
  const origin = facts.origin ?? 'this Domain'
  switch (relation.kind) {
    case 'never-published':
      return relation.registered
        ? `Never published: the registry lists ${origin}, but no Publication of it.`
        : `Never published: the registry has no Domain ${origin} this session can read. It is absent, or this session may not read it.`
    case 'same-revision':
      return `Same revision as the latest Publication, ${relation.latest}: these sources carry the Schema it published.`
    case 'ahead':
      return `Ahead: ${declared} is above the latest Publication, ${relation.latest}, whose Schema revision differs.`
    case 'version-taken':
      return `Version taken: ${declared} is already published under another Schema revision. Raise the version before publishing.`
    case 'behind':
      return `Behind: ${declared} is below the latest Publication, ${relation.latest}, whose Schema revision differs from these sources.`
    case 'undetermined':
      return `Can't tell where it stands. ${relation.reason}`
  }
}

/** The git provenance a Publish would record. */
export function gitSentence(git: GitState | null): string {
  if (git === null)
    return 'Not in a git repository with a commit: a Publish records no commit, and needs --allow-dirty.'
  const commit = git.commit.slice(0, 7)
  return git.dirty
    ? `At commit ${commit}, with uncommitted changes: a Publish records the tree as dirty, and needs --allow-dirty.`
    : `At commit ${commit}, with a clean working tree.`
}

/** The Environments a Domain can publish to. */
export function environmentsSentence(environments: DeclaredEnvironments): string {
  if (!environments.declared)
    return 'The Project declares no Environments: it cannot publish until astrale.config.ts declares one.'
  const names = environments.environments.map((entry) => entry.name)
  const listed =
    names.length === 0
      ? 'no Environment it can read statically'
      : names.length === 1
        ? names[0]!
        : joined(names, 'or')
  const more = environments.complete
    ? ''
    : ' Some entries are not statically readable, so it may declare more.'
  return `Publishes to ${listed}.${more}`
}

// ─── Changes since the last Publication ──────────────────────────────────────

const BUMP_RANK: Record<Bump, number> = { patch: 0, minor: 1, major: 2 }

export function bumpRank(bump: Bump): number {
  return BUMP_RANK[bump]
}

/** `a major bump`, `a minor bump`, `a patch`. */
export function bumpWords(bump: Bump): string {
  return withArticle(bump === 'patch' ? 'patch' : `${bump} bump`)
}

/** The platform's rule for a change's level (`requiredBump`), as the server names its reason. */
export function reasonSentence(reason: ChangeReason): string {
  switch (reason) {
    case 'unsatisfied-requirement':
      return 'A requirement the last Publication satisfied is no longer satisfied: that requires a major bump.'
    case 'addition':
      return 'An addition requires a minor bump.'
    case 'other-change':
      return 'Any other change requires a patch.'
    case 'equivalent-schema':
      return 'A new Schema revision of equivalent meaning requires a patch.'
    case 'code-only':
      return 'New code under the same Schema revision requires a patch.'
  }
}

/** What a compatibility facet is about, as the object of "changed". */
const FACET_WORDS: Record<string, string> = {
  'class.reference': 'what it is as a reference',
  'class.inherit': 'what it inherits',
  'class.composition': 'its composition',
  'class.properties': 'its properties',
  'class.endpoints': 'its relationship ends',
  'class.inheritance': 'whether it may be extended',
  property: 'its definition',
  'property.required': 'whether it is required',
  'method.existence': 'its existence',
  'method.object': 'the object it acts on',
  'method.inheritance': 'how it is inherited',
  'method.signature': 'its signature',
  'function.existence': 'its existence',
  'function.signature': 'its signature',
  policy: 'its expression',
  view: 'its definition',
  core: 'its content',
}

export function facetWords(facet: string): string {
  return FACET_WORDS[facet] ?? facet
}

/**
 * A sentence about a Key in its three parts: the Key said (`subject`), what became of it (`verb`,
 * which a page marks in its state's tone) and the rest, its full stop included.
 */
export interface KeySentence {
  readonly subject: string
  readonly verb: string
  readonly rest: string
}

export const sentenceOf = (parts: KeySentence): string =>
  `${parts.subject} ${parts.verb}${parts.rest}`

/**
 * One change since the baseline, in parts: what changed, and how; none for a change of the build
 * or of the Schema's revision alone, which no Key carries.
 */
export function changeParts(change: PublicationChange, home?: string): KeySentence | undefined {
  if (change.facet === 'build' || change.facet === 'schema') return undefined
  const subject = capital(keyText(change.subject, home))
  const detail = change.detail ? ` (${change.detail})` : ''
  switch (change.state) {
    case 'added':
      return { subject, verb: 'was added', rest: `${detail}.` }
    case 'missing':
      return { subject, verb: 'was removed', rest: `${detail}.` }
    case 'changed':
      return { subject, verb: 'changed', rest: ` ${facetWords(change.facet)}${detail}.` }
  }
}

/** One change since the baseline, as a sentence: what changed, and how. */
export function changeSentence(change: PublicationChange, home?: string): string {
  if (change.facet === 'build') return 'The build changed under the same Schema revision.'
  if (change.facet === 'schema') return 'The Schema has a new revision of equivalent meaning.'
  return sentenceOf(changeParts(change, home)!)
}

/** The changes, highest bump first, in the order the platform listed them within a bump. */
export function changesByBump(changes: readonly PublicationChange[]): Array<{
  bump: Bump
  changes: PublicationChange[]
}> {
  const groups: Array<{ bump: Bump; changes: PublicationChange[] }> = []
  for (const bump of ['major', 'minor', 'patch'] as const) {
    const members = changes.filter((change) => change.bump === bump)
    if (members.length > 0) groups.push({ bump, changes: members })
  }
  return groups
}

/** The bump the changes require, after the 0.x rule, or undefined when nothing was judged. */
export function requiredBump(report: ChangeReport): Bump | undefined {
  return report.effective ?? report.level
}

/** The version the author should declare next, when the declared one is refused. */
export function nextVersion(report: ChangeReport): string | undefined {
  if (report.accepted) return undefined
  return report.suggestion ?? report.next ?? report.minimum
}

/**
 * A sentence of a change report's verdict: words, or the bump the changes require (and, under the
 * 0.x rule, the one that applies), which a page marks with its chip.
 */
export type ReportSentence = string | { readonly requires: Bump; readonly effective?: Bump }

/** The bump the changes require, in words. */
export function requiresSentence(sentence: Exclude<ReportSentence, string>): string {
  const effective =
    sentence.effective === undefined
      ? ''
      : `; under the 0.x rule that is ${bumpWords(sentence.effective)}`
  return `They require ${bumpWords(sentence.requires)}${effective}.`
}

/** The report's verdict, in the order a reader asks: what is compared, what it requires, and whether the version reaches it. */
export function reportSentences(report: ChangeReport): string[] {
  return reportVerdict(report).map((sentence) =>
    typeof sentence === 'string' ? sentence : requiresSentence(sentence),
  )
}

/** `reportSentences`, the requirement kept as its bumps. */
export function reportVerdict(report: ChangeReport): ReportSentence[] {
  const sentences: ReportSentence[] = []
  if (report.registry === 'unregistered') {
    sentences.push(
      `No Domain ${report.origin} is readable in the registry, so nothing is compared: any version is accepted.`,
    )
    return sentences
  }
  if (report.published) {
    sentences.push(
      `${report.declared} already names a Publication: this report is informational, and publishing it again tags no new version.`,
    )
  }
  if (report.baseline === undefined) {
    sentences.push(
      `No stable version up to ${report.declared} is published, so nothing is compared: ${report.declared} is accepted.`,
    )
    return sentences
  }
  const count = report.changes.length
  if (count === 0) {
    sentences.push(`Nothing changed since ${report.baseline}.`)
  } else {
    sentences.push(`${capital(counted(count, 'change'))} since ${report.baseline}.`)
  }
  if (report.level !== undefined)
    sentences.push({
      requires: report.level,
      ...(report.effective !== undefined && report.effective !== report.level
        ? { effective: report.effective }
        : {}),
    })
  if (report.accepted) {
    if (!report.published) sentences.push(`${report.declared} reaches it.`)
  } else {
    const next = nextVersion(report)
    const minimum =
      report.minimum && report.minimum !== next
        ? ` The smallest version the changes admit is ${report.minimum}.`
        : ''
    sentences.push(
      next
        ? `${report.declared} does not reach it: declare ${next} in package.json.${minimum}`
        : `${report.declared} does not reach it: raise the version in package.json.`,
    )
  }
  return sentences
}

// ─── Dependencies and compatibility ──────────────────────────────────────────

/** Which versions of a dependency carry the revision this Domain is built against. */
export function builtAgainstSentence(dependency: DependencyStanding): string {
  const origin = dependency.origin
  const revision = shortRevision(dependency.builtAgainst)
  const copy = dependency.local
  const local =
    copy === null
      ? ''
      : copy.atBuiltAgainst === true
        ? ' The workspace copy is at that revision.'
        : copy.atBuiltAgainst === false
          ? ' The workspace copy has moved past it.'
          : ' The workspace copy has no known revision.'
  if (dependency.index.status !== 'ok')
    return `Built against ${origin} revision ${revision}.${local}`
  const carriers = dependency.carriedBy
  if (carriers.length === 0)
    return `Built against ${origin} revision ${revision}, which no Publication carries.${local}`
  return `Built against ${origin} ${carriers.length === 1 ? carriers[0] : joined(carriers)} (revision ${revision}).${local}`
}

/** A verdict in a few words. */
export function verdictLabel(verdict: CompatibilityVerdict): string {
  if (verdict.compatible && verdict.equivalent) return 'equivalent'
  if (verdict.compatible) return 'compatible'
  return `breaks ${counted(verdict.unsatisfied.length, 'requirement')}`
}

/** A verdict as a sentence, about the dependent and one version of its dependency. */
export function verdictSentence(
  verdict: CompatibilityVerdict,
  name: string,
  /** the versions sharing this verdict, when one verdict stands for several of one revision */
  versions?: readonly string[],
): string {
  const several = versions !== undefined && versions.length > 1
  const target = several
    ? joined(versions)
    : verdict.target.kind === 'publication'
      ? verdict.target.version
      : 'the workspace copy'
  if (verdict.compatible && verdict.equivalent)
    return `${target} ${several ? 'mean' : 'means'} exactly what ${name} was built against.`
  if (verdict.compatible)
    return `${name} still holds against ${target}: every requirement is satisfied.`
  return `${name} does not hold against ${target}: ${counted(verdict.unsatisfied.length, 'requirement')} ${verdict.unsatisfied.length === 1 ? 'is' : 'are'} unsatisfied.`
}

export interface CompatibilityTally {
  /** Publications judged compatible */
  holds: number
  /** Publications judged incompatible */
  breaks: number
  /** Publications whose verdict could not be read */
  unknown: number
  /** every Publication listed */
  total: number
  /** the versions that break, highest first */
  breaking: string[]
}

/** How the readable Publications of one dependency judge, counted. */
export function tally(dependency: DependencyCompatibility): CompatibilityTally | undefined {
  if (dependency.publications.status !== 'ok') return undefined
  const result: CompatibilityTally = { holds: 0, breaks: 0, unknown: 0, total: 0, breaking: [] }
  for (const publication of dependency.publications.value) {
    result.total += 1
    if (publication.verdict.status !== 'ok') result.unknown += 1
    else if (publication.verdict.value.compatible) result.holds += 1
    else {
      result.breaks += 1
      result.breaking.push(publication.version)
    }
  }
  return result
}

/** A dependency's compatibility in a few words: how many of its Publications still hold. */
export function tallyLabel(counts: CompatibilityTally): string {
  if (counts.total === 0) return 'no Publications'
  if (counts.breaks === 0 && counts.unknown === 0)
    return counts.total === 1 ? 'holds on its one version' : `holds on all ${counts.total}`
  if (counts.breaks > 0) return `breaks on ${counts.breaks} of ${counts.total}`
  return `holds on ${counts.holds} of ${counts.total}; ${counts.unknown} can't tell`
}

/** A dependency's compatibility as a sentence. */
export function tallySentence(counts: CompatibilityTally, name: string, origin: string): string {
  if (counts.total === 0) return `The registry lists no Publication of ${origin}.`
  const parts: string[] = []
  if (counts.breaks === 0 && counts.unknown === 0)
    parts.push(
      counts.total === 1
        ? `${name} holds against the one Publication of ${origin}.`
        : `${name} holds against all ${counts.total} Publications of ${origin}.`,
    )
  else {
    parts.push(
      `${name} holds against ${counts.holds} of ${counts.total} Publications of ${origin}.`,
    )
    if (counts.breaks > 0)
      parts.push(`${joined(counts.breaking)} ${counts.breaks === 1 ? 'breaks' : 'break'} it.`)
    if (counts.unknown > 0) parts.push(`${counted(counts.unknown, 'verdict')} could not be read.`)
  }
  return parts.join(' ')
}

/** How a member uses a requirement, after "Required by X". */
const RELATION_WORDS: Record<string, string> = {
  extends: 'as a parent it extends',
  core: 'in its core Nodes',
  endpoint: 'as a relationship end',
  value: 'as a value type',
  policy: 'in a Policy',
  pattern: 'in a rule pattern',
  abstract: 'as an abstract member it implements',
  selection: 'in a selection',
  capability: 'as a declared capability',
}

/** Why the dependent requires a subject, one usage at a time. */
export function usageSentence(
  usage: UnsatisfiedAssessment['usages'][number],
  home: string,
): string {
  const who =
    usage.key === undefined ? `${originShort(usage.origin)} itself` : keyText(usage.key, home)
  if (usage.relation === 'member') return `as a member of ${who}`
  return `by ${who} ${RELATION_WORDS[usage.relation] ?? `(${usage.relation})`}`
}

/** An unsatisfied requirement in words: the subject and what the compared version does to it. */
export function unsatisfiedParts(
  assessment: UnsatisfiedAssessment,
  target: string,
  home: string,
): KeySentence {
  const subject = capital(keyText(assessment.subject.key, home))
  switch (assessment.state) {
    case 'missing':
      return { subject, verb: 'is missing', rest: ` from ${target}.` }
    case 'added':
      return { subject, verb: 'is new', rest: ` in ${target}.` }
    case 'changed':
      return { subject, verb: 'differs', rest: ` in ${target}: ${facetWords(assessment.facet)}.` }
    case 'equal':
      return {
        subject,
        verb: 'is the same',
        rest: ` in ${target}, yet ${facetWords(assessment.facet)} is unsatisfied.`,
      }
  }
}

/** An unsatisfied requirement as one sentence. */
export function unsatisfiedSentence(
  assessment: UnsatisfiedAssessment,
  target: string,
  home: string,
): string {
  return sentenceOf(unsatisfiedParts(assessment, target, home))
}

/** Every usage of an unsatisfied requirement, folded past `limit`. */
export function usagesSentence(
  usages: UnsatisfiedAssessment['usages'],
  home: string,
  limit = 2,
): string {
  if (usages.length === 0) return ''
  const shown = usages.slice(0, limit).map((usage) => usageSentence(usage, home))
  const more = usages.length - shown.length
  const list = more > 0 ? `${shown.join('; ')}; and ${more} more` : joined(shown)
  return `Required ${list}.`
}

function observed(value: ObservedValue | undefined): string | undefined {
  if (value === undefined) return undefined
  if ('elided' in value) return `a value of ${value.bytes} bytes`
  const text = JSON.stringify(value.value)
  if (text === undefined) return String(value.value)
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

/** A JSON Pointer's last token, unescaped: `/properties/kernel.astrale.ai:class.Named.property.name` → the Key. */
function lastToken(path: string): string {
  const token = path.split('/').pop() ?? path
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** One difference of an unsatisfied requirement, as a sentence: what is required and what is provided. */
export function differenceSentence(
  difference: UnsatisfiedAssessment['differences'][number],
  home: string,
): string {
  const token = lastToken(difference.path)
  const thing = token.includes(':') ? keyText(token, home) : difference.path || 'the value'
  const required = observed(difference.required)
  const provided = observed(difference.provided)
  if (required !== undefined && provided === undefined)
    return required === 'true'
      ? `${capital(thing)} is required, and absent.`
      : `${capital(thing)} is required as ${required}, and absent.`
  if (required === undefined && provided !== undefined)
    return `${capital(thing)} is provided as ${provided}, which nothing requires.`
  return `${capital(thing)}: requires ${required ?? 'nothing'}, provides ${provided ?? 'nothing'}.`
}

const NOUN_PLURALS: Record<string, string> = {
  Class: 'Classes',
  property: 'properties',
  method: 'methods',
  function: 'functions',
  Policy: 'Policies',
  View: 'Views',
  'core Node': 'core Nodes',
  Integration: 'Integrations',
}

/** What the unsatisfied requirements are about, counted by kind: `3 Classes, 12 properties and 1 Policy`. */
export function unsatisfiedSummary(unsatisfied: readonly UnsatisfiedAssessment[]): string {
  const counts = new Map<string, number>()
  for (const assessment of unsatisfied) {
    const noun = keyWords(assessment.subject.key).noun || assessment.subject.kind
    counts.set(noun, (counts.get(noun) ?? 0) + 1)
  }
  return joined(
    [...counts].map(([noun, count]) => counted(count, noun, NOUN_PLURALS[noun] ?? `${noun}s`)),
  )
}

/** Published versions that share one verdict, because they carry one Schema revision. */
export interface VerdictGroup {
  /** highest first, as the index lists them */
  versions: string[]
  yanked: string[]
  verdict: DependencyCompatibilityVerdict
}

type DependencyCompatibilityVerdict = Extract<
  DependencyCompatibility['publications'],
  { status: 'ok' }
>['value'][number]['verdict']

/**
 * Each readable version of a dependency with its verdict, versions of one Schema revision
 * (`sameRevisionAs`) shown once. Undefined when the index itself could not be read.
 */
export function verdictGroups(dependency: DependencyCompatibility): VerdictGroup[] | undefined {
  if (dependency.publications.status !== 'ok') return undefined
  const groups: VerdictGroup[] = []
  const placed = new Map<string, VerdictGroup>()
  for (const publication of dependency.publications.value) {
    const existing = placed.get(publication.version)
    if (existing) {
      existing.versions.push(publication.version)
      if (publication.yanked) existing.yanked.push(publication.version)
      continue
    }
    const group: VerdictGroup = {
      versions: [publication.version],
      yanked: publication.yanked ? [publication.version] : [],
      verdict: publication.verdict,
    }
    groups.push(group)
    if (publication.verdict.status === 'ok')
      for (const same of publication.verdict.value.sameRevisionAs) placed.set(same, group)
  }
  return groups
}

// ─── The Workspace at a glance ───────────────────────────────────────────────

/** Why a Domain's changes went unjudged, as the end of a sentence that names it. */
const UNJUDGED: Record<Exclude<RemoteFailure['status'], SessionCause['status']>, string> = {
  'not-found': "has changes that can't be judged: the registry has nothing readable for it",
  refused: "has changes that can't be judged: the registry refused the read",
  failed: "has changes that can't be judged",
}

/**
 * A cause outside every Domain that keeps the registry unread: the session is signed out, or the
 * registry is out of reach. It is said once for the Workspace, with the one thing that ends it.
 */
export interface SessionCause {
  status: 'signed-out' | 'offline'
  /** the Domains it leaves unjudged, in the Workspace's order */
  domainIds: string[]
  sentence: string
}

const isSessionStatus = (status: string): status is SessionCause['status'] =>
  status === 'signed-out' || status === 'offline'

/** The session causes that kept any of a Domain's registry reads unanswered. */
function sessionStatuses(domain: DomainFacts): Set<SessionCause['status']> {
  const statuses: string[] = []
  if (domain.standing.status === 'ready') statuses.push(domain.standing.value.index.status)
  if (domain.changes.status === 'ready') statuses.push(domain.changes.value.status)
  if (domain.dependencies.status === 'ready')
    for (const dependency of domain.dependencies.value.dependencies)
      statuses.push(dependency.index.status)
  if (domain.compatibility.status === 'ready')
    for (const dependency of domain.compatibility.value.dependencies)
      statuses.push(dependency.publications.status)
  return new Set(statuses.filter(isSessionStatus))
}

const SESSION_HEADLINE: Record<SessionCause['status'], string> = {
  'signed-out': "Signed out: this Studio's astrale session cannot read the registry",
  offline: 'The registry could not be reached',
}

/** What asks the author to act: the causes shared by every Domain, then one sentence per Domain. */
export interface Attention {
  causes: SessionCause[]
  sentences: Array<{ domainId: string; sentence: string }>
}

/**
 * What asks the author to act. A session cause, said once: the Domains it leaves unjudged and
 * what ends it. Then one sentence per Domain: a version below or already taken, a version that
 * does not reach its changes' bump, a change report that cannot be judged for a reason of its
 * own, a dependency version that breaks. Domains with nothing to say are left out.
 */
export function attentionSentences(domains: readonly DomainFacts[]): Attention {
  const unjudged = new Map<SessionCause['status'], string[]>()
  const names = new Map<string, string>()
  const sentences: Array<{ domainId: string; sentence: string }> = []
  for (const domain of domains) {
    const local = domain.local.status === 'ready' ? domain.local.value : undefined
    const name = domainName(local?.origin ?? domain.summary.origin)
    names.set(domain.summary.id, name)
    for (const status of sessionStatuses(domain))
      unjudged.set(status, [...(unjudged.get(status) ?? []), domain.summary.id])
    const parts: string[] = []
    if (domain.standing.status === 'ready') {
      const relation = domain.standing.value.relation
      if (relation.kind === 'behind')
        parts.push(
          `declares ${local?.declared ?? 'a version'} below the latest Publication, ${relation.latest}`,
        )
      if (relation.kind === 'version-taken')
        parts.push(
          `declares ${local?.declared ?? 'a version'}, which is already published under another Schema revision`,
        )
    }
    // a reason of the Domain's own is the platform's or the registry's words, said after it
    let reason: string | undefined
    if (domain.changes.status === 'ready') {
      const answer = domain.changes.value
      if (answer.status === 'ok') {
        const next = nextVersion(answer.value)
        if (next) parts.push(`must declare ${next} for its changes`)
      } else if (!isSessionStatus(answer.status)) {
        parts.push(UNJUDGED[answer.status])
        if (answer.status !== 'not-found') reason = answer.message.split('\n')[0]?.trim()
      }
    }
    if (domain.compatibility.status === 'ready') {
      const breaking = domain.compatibility.value.dependencies.flatMap((dependency) => {
        const counts = tally(dependency)
        return counts && counts.breaks > 0
          ? [`${counted(counts.breaks, 'version')} of ${domainName(dependency.origin)}`]
          : []
      })
      if (breaking.length > 0) parts.push(`does not hold against ${joined(breaking)}`)
    }
    if (local && local.revision === null) parts.push('has a Schema its SDK does not admit')
    if (parts.length > 0)
      sentences.push({
        domainId: domain.summary.id,
        sentence: `${name} ${joined(parts)}.${reason ? ` The reason given: “${reason}”` : ''}`,
      })
  }
  const causes = (['signed-out', 'offline'] as const).flatMap((status): SessionCause[] => {
    const domainIds = unjudged.get(status)
    if (!domainIds) return []
    const named = joined(domainIds.map((id) => names.get(id)!))
    const verb = domainIds.length === 1 ? 'is' : 'are'
    return [
      {
        status,
        domainIds,
        sentence: `${SESSION_HEADLINE[status]}, so ${named} ${verb} not judged against it. ${SESSION_REMEDY[status]}`,
      },
    ]
  })
  return { causes, sentences }
}
