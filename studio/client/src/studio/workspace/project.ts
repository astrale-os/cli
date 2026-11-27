/**
 * The Workspace map: a pure projector from what the Workspace level knows to a Scene, so the
 * Workspace moves, selects and remembers on the Studio's own canvas like every other level.
 *
 * - Each workspace Domain is one card: its name, its declared version, where it stands against
 *   its last Publication, the bump its changes require once judged, and its build state.
 * - Each dependency is one link, from the dependent to the Domain it depends on. Its line says
 *   what its two cards do not: the revision the dependent is built against, and the verdict on
 *   the dependency's Publications, in the verdict's tone. The Index names it by its ends.
 * - A dependency that is no workspace Domain (the Kernel, Shell…) is a quieter card: nothing a
 *   Schema depends on is silently absent.
 * - The map leads its links across or down, whichever reads it larger whole: a workspace of few
 *   Domains stands as a stack, what each depends on below it.
 * - Every fact still being read, not asked for, or unreadable says so on the card or the link.
 *
 * The cost guard: past `MAP_DOMAIN_BUDGET` workspace Domains the rest are counted, not drawn.
 */

import type {
  DependencyCompatibility,
  DependencyStanding,
  DomainLocal,
  PublicationRelation,
  RemoteFailure,
} from '@shared/contracts/versions'

import type {
  Scene,
  SceneBadge,
  SceneCount,
  SceneFold,
  SceneLink,
  SceneNode,
  SceneRow,
  SceneTone,
} from '../scene/types'
import type { DomainFacts, Fact } from './facts'

import { listed } from '../scene/types'
import { domainOfOrigin, originOf, valueOf } from './facts'
import {
  bumpWords,
  counted,
  domainName,
  failureWords,
  nextVersion,
  relationLabel,
  relationNeedsAction,
  requiredBump,
  shortRevision,
  tally,
  tallyLabel,
} from './words'

/** The most workspace Domains the map draws; the rest are counted. */
export const MAP_DOMAIN_BUDGET = 160

/** The selection target of a workspace Domain's card. */
export function domainNodeId(domainId: string): string {
  return `domain:${domainId}`
}

/** The selection target of a Domain the workspace does not hold, by its origin. */
export function originNodeId(origin: string): string {
  return `origin:${origin}`
}

/** The group of the Domains the workspace does not hold. */
export const OUTSIDE_GROUP = 'group:outside'

/** The selection target of one dependency link. */
export function dependencyLinkId(domainId: string, alias: string): string {
  return `dependency:${domainId}:${alias}`
}

/** What a selection target names on the Workspace map. */
export type WorkspaceTarget =
  | { kind: 'domain'; domainId: string }
  | { kind: 'origin'; origin: string }
  | { kind: 'dependency'; domainId: string; alias: string }

export function targetOf(id: string | undefined): WorkspaceTarget | undefined {
  if (!id) return undefined
  if (id.startsWith('domain:')) return { kind: 'domain', domainId: id.slice('domain:'.length) }
  if (id.startsWith('origin:')) return { kind: 'origin', origin: id.slice('origin:'.length) }
  const link = /^dependency:([^:]+):(.+)$/.exec(id)
  if (link) return { kind: 'dependency', domainId: link[1]!, alias: link[2]! }
  return undefined
}

const STATUS_WORDS: Record<RemoteFailure['status'], string> = {
  'signed-out': 'signed out',
  offline: 'offline',
  'not-found': 'not found',
  refused: 'refused',
  failed: "can't tell",
}

/** A remote failure in two words, as a badge or a link label reads it. */
export function statusWords(failure: Pick<RemoteFailure, 'status'>): string {
  return STATUS_WORDS[failure.status]
}

/** A cause outside every Domain that keeps the registry unread: the session's. */
type SessionStatus = Extract<RemoteFailure['status'], 'signed-out' | 'offline'>

const isSession = (status: string): status is SessionStatus =>
  status === 'signed-out' || status === 'offline'

/**
 * A registry read the session refused, said as the Workspace panel says it: the cause in two
 * words, with the one thing that ends it as its title.
 */
function sessionBadge(status: SessionStatus): SceneBadge {
  return {
    label: statusWords({ status }),
    tone: 'muted',
    title: failureWords({ status }, 'the registry').remedy,
  }
}

/** The session cause that refused a Domain's index read, if one did. */
function indexRefusal(domain: DomainFacts): SessionStatus | undefined {
  const status = valueOf(domain.standing)?.index.status
  return status !== undefined && isSession(status) ? status : undefined
}

/**
 * A local version's relation to the registry's Publications as the map's Domain card says it: in
 * the warning tone where it asks the author to act before publishing, in the Domain's tone ahead
 * of them, quiet otherwise. A page beside the map wears the same badge (`BadgeView`).
 */
export function relationBadge(relation: PublicationRelation): SceneBadge {
  const label = relationLabel(relation)
  if (relationNeedsAction(relation)) return { label, tone: 'warning' }
  if (relation.kind === 'ahead') return { label, tone: 'node' }
  if (relation.kind === 'undetermined') return { label, tone: 'muted', title: relation.reason }
  return { label, tone: 'muted' }
}

/**
 * A Domain's standing as its map card's first badge says it: the session's cause where the
 * registry read was refused, the read still running or failing, else its `relationBadge`; none
 * before the read starts.
 */
export function standingBadge(domain: DomainFacts): SceneBadge | undefined {
  const standing = domain.standing
  const refused = indexRefusal(domain)
  if (refused) return sessionBadge(refused)
  if (standing.status === 'loading') return { label: 'reading the registry…', tone: 'muted' }
  if (standing.status === 'error')
    return { label: "can't tell", tone: 'muted', title: standing.message }
  if (standing.status === 'ready') return relationBadge(standing.value.relation)
  return undefined
}

/**
 * What a card says of its changes. A judgement the session refuses — its index read already
 * refused, or its own read — is said once, as the session's cause: never as a judgement still
 * running, nor as a change that cannot be judged.
 */
function changesBadges(domain: DomainFacts): SceneBadge[] {
  const changes = domain.changes
  const refused = indexRefusal(domain)
  if (changes.status === 'loading')
    return refused ? [] : [{ label: 'judging changes…', tone: 'muted' }]
  if (changes.status === 'error')
    return [{ label: "changes can't be judged", tone: 'warning', title: changes.message }]
  if (changes.status !== 'ready') return []
  const report = changes.value
  if (report.status !== 'ok' && isSession(report.status))
    return refused ? [] : [sessionBadge(report.status)]
  if (report.status !== 'ok')
    return [{ label: "changes can't be judged", tone: 'warning', title: report.message }]
  const badges: SceneBadge[] = []
  const bump = requiredBump(report.value)
  if (bump !== undefined && report.value.changes.length > 0)
    badges.push({
      label: `${bump} bump`,
      tone: 'muted',
      title: `The changes since ${report.value.baseline ?? 'the last Publication'} require ${bumpWords(bump)}.`,
    })
  const next = nextVersion(report.value)
  if (next !== undefined)
    badges.push({
      label: `declare ${next}`,
      tone: 'warning',
      title: `${report.value.declared} does not reach the bump its changes require.`,
    })
  return badges
}

function buildBadges(domain: DomainFacts, local: DomainLocal | undefined): SceneBadge[] {
  const badges: SceneBadge[] = []
  if (!domain.summary.depsInstalled)
    badges.push({
      label: 'dependencies not installed',
      tone: 'warning',
      title: 'Install the Domain’s dependencies: its SDK judges its Schema.',
    })
  if (local && local.revision === null)
    badges.push({
      label: 'Schema not admitted',
      tone: 'warning',
      title: local.revisionError ?? 'The installed SDK does not admit the current Schema.',
    })
  if (domain.local.status === 'error')
    badges.push({ label: 'sources unreadable', tone: 'warning', title: domain.local.message })
  return badges
}

function domainRows(domain: DomainFacts, local: DomainLocal | undefined): SceneRow[] {
  const id = domainNodeId(domain.summary.id)
  const rows: SceneRow[] = []
  if (local?.revision)
    rows.push({ id: `${id}:revision`, label: 'revision', detail: shortRevision(local.revision) })
  const standing = valueOf(domain.standing)
  if (standing?.latest)
    rows.push({
      id: `${id}:latest`,
      label: 'latest',
      detail: `${standing.latest.version}${standing.latest.yanked ? ' (yanked)' : ''}`,
    })
  if (local) {
    const names = local.environments.environments.map((entry) => entry.name)
    rows.push({
      id: `${id}:environments`,
      label: 'publishes to',
      detail: !local.environments.declared
        ? 'no Environment'
        : names.length > 0
          ? listed(names)
          : 'unreadable',
    })
    rows.push({
      id: `${id}:git`,
      label: 'git',
      detail:
        local.git === null
          ? 'no commit'
          : `${local.git.commit.slice(0, 7)}${local.git.dirty ? ' · dirty' : ''}`,
    })
  }
  return rows
}

function domainNode(domain: DomainFacts): SceneNode {
  const local = valueOf(domain.local)
  const origin = originOf(domain)
  const report = valueOf(domain.changes)
  const counts: SceneCount[] = []
  if (report?.status === 'ok') counts.push({ label: 'changes', value: report.value.changes.length })
  if (local) counts.push({ label: 'dependencies', value: local.dependencies.length })
  const standing = standingBadge(domain)
  const badges = [
    ...(standing ? [standing] : []),
    ...changesBadges(domain),
    ...buildBadges(domain, local),
  ]
  return {
    id: domainNodeId(domain.summary.id),
    anchor: `domain.${origin}`,
    anchorDomain: domain.summary.id,
    kind: 'Domain',
    shape: 'card',
    label: domainName(origin),
    sublabel: local
      ? (local.declared ?? 'no version')
      : domain.local.status === 'loading'
        ? '…'
        : undefined,
    icon: { glyph: 'module' },
    tone: 'node',
    ...(counts.length > 0 ? { counts } : {}),
    ...(badges.length > 0 ? { badges } : {}),
    rows: domainRows(domain, local),
    keywords: [origin, ...(local?.packageName ? [local.packageName] : [])],
  }
}

/** What any dependent's dependencies answer says of a Domain outside the workspace. */
function otherDomainNode(origin: string, standings: readonly DependencyStanding[]): SceneNode {
  const index =
    standings.find((standing) => standing.index.status === 'ok')?.index ?? standings[0]?.index
  const badges: SceneBadge[] = []
  if (index?.status === 'ok') {
    const publications = index.value.publications
    badges.push({ label: counted(publications.length, 'Publication'), tone: 'muted' })
  } else if (index && isSession(index.status)) {
    badges.push(sessionBadge(index.status))
  } else if (index) {
    badges.push({ label: statusWords(index), tone: 'muted', title: index.message })
  }
  return {
    id: originNodeId(origin),
    kind: 'other Domain',
    shape: 'card',
    label: domainName(origin),
    sublabel: 'not in this Workspace',
    group: OUTSIDE_GROUP,
    icon: { glyph: 'module' },
    tone: 'muted',
    ...(badges.length > 0 ? { badges } : {}),
    keywords: [origin],
  }
}

/**
 * The revision a dependent is built against, as its link says it: the versions that carry it
 * (`0.3.0`, `0.8.7/0.8.8 +1`), `workspace copy` when it is the workspace Domain's own and
 * unpublished, else the revision itself, said unpublished when the registry carries it nowhere.
 */
function builtAgainstWords(standing: DependencyStanding | undefined): string | undefined {
  if (!standing) return undefined
  const revision = shortRevision(standing.builtAgainst)
  if (standing.local?.atBuiltAgainst === true && standing.carriedBy.length === 0)
    return 'workspace copy'
  if (standing.index.status !== 'ok') return revision
  if (standing.carriedBy.length === 0) return `${revision}, unpublished`
  const [first, second] = standing.carriedBy
  const more = standing.carriedBy.length - 2
  return `${second ? `${first}/${second}` : first}${more > 0 ? ` +${more}` : ''}`
}

/** What a dependency link says of the dependency's versions, in a few words. */
export interface LinkVerdict {
  label?: string
  breaks: boolean
  /** the verdicts are known */
  judged: boolean
  title?: string
}

/** The verdict a dependency's link carries, shared by the map and the Domain page. */
export function linkVerdict(
  compatibility: Fact<unknown>,
  dependency: DependencyCompatibility | undefined,
): LinkVerdict {
  if (compatibility.status === 'loading') return { label: 'judging…', breaks: false, judged: false }
  if (compatibility.status === 'error')
    return { label: "can't tell", breaks: false, judged: false, title: compatibility.message }
  if (compatibility.status !== 'ready' || !dependency) return { breaks: false, judged: false }
  const localBreaks =
    dependency.local?.verdict.status === 'ok' && !dependency.local.verdict.value.compatible
  if (dependency.publications.status !== 'ok')
    return {
      label: localBreaks ? `breaks the workspace copy` : statusWords(dependency.publications),
      breaks: localBreaks,
      judged: localBreaks,
      title: dependency.publications.message,
    }
  const counts = tally(dependency)!
  const label = localBreaks
    ? `${tallyLabel(counts)} · breaks the workspace copy`
    : tallyLabel(counts)
  return { label, breaks: counts.breaks > 0 || localBreaks, judged: counts.unknown === 0 }
}

/** A verdict's tone: it breaks, it holds, or it is not known yet. */
export function verdictTone(verdict: LinkVerdict): SceneTone {
  return verdict.breaks ? 'warning' : verdict.judged ? 'success' : 'muted'
}

/** The Workspace map of `domains`, in the order given. */
export function projectWorkspace(domains: readonly DomainFacts[]): Scene {
  const drawn = domains.slice(0, MAP_DOMAIN_BUDGET)
  const nodes: SceneNode[] = drawn.map(domainNode)
  const links: SceneLink[] = []
  const others = new Map<string, DependencyStanding[]>()

  for (const domain of drawn) {
    const local = valueOf(domain.local)
    if (!local) continue
    const standings = valueOf(domain.dependencies)?.dependencies ?? []
    const matrix = valueOf(domain.compatibility)
    for (const dependency of local.dependencies) {
      const standing = standings.find((candidate) => candidate.alias === dependency.alias)
      const home = domainOfOrigin(drawn, dependency.origin)
      let to: string
      if (home && home.summary.id !== domain.summary.id) to = domainNodeId(home.summary.id)
      else {
        to = originNodeId(dependency.origin)
        const seen = others.get(dependency.origin) ?? []
        if (standing) seen.push(standing)
        others.set(dependency.origin, seen)
      }
      const verdict = linkVerdict(
        domain.compatibility,
        matrix?.dependencies.find((candidate) => candidate.origin === dependency.origin),
      )
      links.push({
        id: dependencyLinkId(domain.summary.id, dependency.alias),
        kind: 'dependency',
        label: [builtAgainstWords(standing), verdict.label].filter(Boolean).join(' · '),
        name: `${domainName(originOf(domain))} → ${domainName(dependency.origin)}`,
        from: { nodes: [domainNodeId(domain.summary.id)] },
        to: { nodes: [to] },
        directed: true,
        ...(verdict.label === undefined ? {} : { tone: verdictTone(verdict) }),
        ...(verdict.judged ? {} : { dashed: true }),
      })
    }
  }

  for (const [origin, standings] of [...others].sort(([left], [right]) =>
    left.localeCompare(right),
  ))
    nodes.push(otherDomainNode(origin, standings))

  const folded: SceneFold[] = []
  if (domains.length > drawn.length)
    folded.push({
      label: 'Domains',
      count: domains.length - drawn.length,
      reason: `not drawn: the map draws at most ${MAP_DOMAIN_BUDGET}; the Workspace panel lists every one`,
    })
  const unjudged = drawn.filter((domain) => domain.changes.status === 'idle').length
  if (unjudged > 0)
    folded.push({
      label: 'Not judged',
      count: unjudged,
      reason: 'select a Domain to judge its changes and compatibility',
    })

  const groups = others.size > 0 ? [{ id: OUTSIDE_GROUP, label: 'Outside this Workspace' }] : []
  const scene: Omit<Scene, 'key'> = {
    nodes,
    links,
    groups,
    folded,
    trunkLabel: 'labels',
    flow: 'either',
  }
  return { key: `workspace:${digest(JSON.stringify(scene))}`, ...scene }
}

/** A short, stable digest of a string (FNV-1a), for the Scene's key. */
function digest(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
