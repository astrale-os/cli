/**
 * SemVer 2.0.0 precedence (§11) of two canonical versions, as `acceptVersion` of
 * `@astrale-os/sdk/versioning` admits them: no leading `v`, no build metadata. It orders the
 * registry index only; which version a reference or a bump selects stays in the SDK module.
 * Returns a negative number when `left` precedes `right`.
 *
 * Local until `@astrale-os/sdk/versioning` exports a precedence compare (0.6.0-beta.11 exports
 * none): delete this module and use the SDK's once a CLI-pinned SDK release does (CT29 precision).
 */
export function compareVersions(left: string, right: string): number {
  const a = split(left)
  const b = split(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = compareNumeric(a.core[index]!, b.core[index]!)
    if (difference !== 0) return difference
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    // A release outranks every pre-release of the same core.
    return b.prerelease.length - a.prerelease.length
  }
  const length = Math.min(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const difference = compareIdentifier(a.prerelease[index]!, b.prerelease[index]!)
    if (difference !== 0) return difference
  }
  return a.prerelease.length - b.prerelease.length
}

/** Highest precedence first, as `RegistryIndexV1.publications` lists them. */
export function byPrecedenceDescending<Entry extends { readonly version: string }>(
  left: Entry,
  right: Entry,
): number {
  return compareVersions(right.version, left.version)
}

function split(version: string): {
  readonly core: readonly string[]
  readonly prerelease: readonly string[]
} {
  const dash = version.indexOf('-')
  const core = (dash === -1 ? version : version.slice(0, dash)).split('.')
  if (core.length !== 3) throw new TypeError(`Version ${JSON.stringify(version)} is not canonical.`)
  return { core, prerelease: dash === -1 ? [] : version.slice(dash + 1).split('.') }
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^[0-9]+$/u.test(left)
  const rightNumeric = /^[0-9]+$/u.test(right)
  if (leftNumeric && rightNumeric) return compareNumeric(left, right)
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** Canonical numeric identifiers carry no leading zero, so length orders them first. */
function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length
  return left < right ? -1 : left > right ? 1 : 0
}
