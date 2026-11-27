/**
 * How a local Schema revision relates to an origin's Publications. Pure: it reads only the
 * registry index and the local facts it is given. Version order is SemVer precedence, as the
 * registry orders its index.
 */
import type {
  DomainLocal,
  PublicationRelation,
  PublicationSummary,
  Remote,
  RegistryIndex,
} from '../../../shared/contracts/versions'

import { compareVersions } from '../../../../src/admin/registry/order'

/** The published versions whose Schema revision is `revision`, highest first. */
export function carriersOf(index: RegistryIndex, revision: string | null): string[] {
  if (revision === null) return []
  return index.publications
    .filter((publication) => publication.schemaRevision === revision)
    .map((publication) => publication.version)
}

/**
 * The Publication `astrale-domain diff` compares a declared version against: the highest stable
 * version at or below it, yanked ones included. Undefined when none is published.
 */
export function baselineOf(index: RegistryIndex, declared: string): PublicationSummary | undefined {
  return index.publications.find(
    (publication) => !publication.version.includes('-') && atOrBelow(publication.version, declared),
  )
}

function atOrBelow(version: string, bound: string): boolean {
  try {
    return compareVersions(version, bound) <= 0
  } catch {
    return false
  }
}

export function relationOf(
  local: Pick<DomainLocal, 'declared' | 'revision'>,
  index: Remote<RegistryIndex>,
): PublicationRelation {
  if (index.status === 'not-found') return { kind: 'never-published', registered: false }
  if (index.status !== 'ok') {
    return {
      kind: 'undetermined',
      reason: `The registry index could not be read: ${index.message}`,
    }
  }
  const latest = index.value.publications[0]
  if (latest === undefined) return { kind: 'never-published', registered: true }
  if (local.revision === null) {
    return { kind: 'undetermined', reason: 'The local Schema revision is unknown.' }
  }
  if (latest.schemaRevision === local.revision) {
    return { kind: 'same-revision', latest: latest.version }
  }
  if (local.declared === null) {
    return { kind: 'undetermined', reason: 'package.json declares no version.' }
  }
  if (index.value.publications.some((publication) => publication.version === local.declared)) {
    return { kind: 'version-taken', latest: latest.version }
  }
  try {
    return compareVersions(local.declared, latest.version) > 0
      ? { kind: 'ahead', latest: latest.version }
      : { kind: 'behind', latest: latest.version }
  } catch {
    return {
      kind: 'undetermined',
      reason: `package.json version ${JSON.stringify(local.declared)} is not a canonical version.`,
    }
  }
}
