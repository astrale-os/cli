import { fetchBounded, fetchJson, HttpStatusError } from './fetch'
import { isSafeRelative } from './files'
import {
  isRecord,
  RELEASE_VERSION,
  UI_ITEM_ADDRESS,
  UiError,
  type UiCompatibility,
  type UiRefusedItem,
  type UiRegistry,
  type UiRegistryItem,
  type UiRelease,
  type UiReleaseIdentity,
} from './model'
import { themeCssRefusal } from './theme'

const NPM_PACKAGE = 'https://registry.npmjs.org/@astrale-os/ui'
const GITHUB_API = 'https://api.github.com/repos/astrale-os/ui'
const GITHUB_WEB = 'https://github.com/astrale-os/ui'
const RAW = 'https://raw.githubusercontent.com/astrale-os/ui'
const MAX_DOCUMENT_BYTES = 1_048_576
const MAX_REGISTRY_DOCUMENTS = 100

type Fetch = typeof fetch
type RegistrySource = {
  name?: string
  homepage?: string
  include?: string[]
  items?: unknown[]
}

function json<T>(fetcher: Fetch, url: string, label: string): Promise<T> {
  return fetchJson<T>(fetcher, url, {
    label,
    code: 'UI_REGISTRY_UNAVAILABLE',
    maxBytes: MAX_DOCUMENT_BYTES,
  })
}

function unavailable(message: string): UiError {
  return new UiError('UI_REGISTRY_UNAVAILABLE', message)
}

export async function resolveUiRelease(
  requested?: string,
  fetcher: Fetch = fetch,
): Promise<UiRelease> {
  return readUiReleaseSnapshot(await resolveUiReleaseIdentity(requested, fetcher), fetcher)
}

export async function resolveUiReleaseIdentity(
  requested?: string,
  fetcher: Fetch = fetch,
): Promise<UiReleaseIdentity> {
  const versionDocument = requested
    ? { version: requested.replace(/^v/u, '') }
    : await json<{ version: string }>(fetcher, NPM_PACKAGE + '/beta', 'npm UI release')
  const version = versionDocument.version
  if (!RELEASE_VERSION.test(version)) {
    throw unavailable('Invalid UI release version: ' + version)
  }
  if (!requested && !/-beta\.\d+$/u.test(version)) {
    throw unavailable('Invalid UI beta release version: ' + version)
  }
  const ref = 'v' + version
  const commit = await resolveReleaseCommit(ref, fetcher)
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw unavailable('UI ref ' + ref + ' did not resolve to a commit.')
  }
  return { version, ref, commit }
}

async function resolveReleaseCommit(ref: string, fetcher: Fetch): Promise<string> {
  try {
    const reference = await json<{
      object: { type: 'commit' | 'tag'; sha: string; url: string }
    }>(fetcher, GITHUB_API + '/git/ref/tags/' + encodeURIComponent(ref), 'UI ref ' + ref)
    return reference.object.type === 'commit'
      ? reference.object.sha
      : (
          await json<{ object: { sha: string } }>(
            fetcher,
            reference.object.url,
            'annotated UI tag ' + ref,
          )
        ).object.sha
  } catch (cause) {
    const status =
      cause instanceof UiError && cause.cause instanceof HttpStatusError
        ? cause.cause.status
        : undefined
    if (status !== 403 && status !== 429 && !(status !== undefined && status >= 500)) throw cause
  }

  const html = (
    await fetchBounded(fetcher, GITHUB_WEB + '/releases/tag/' + encodeURIComponent(ref), {
      label: 'UI release ' + ref,
      code: 'UI_REGISTRY_UNAVAILABLE',
      maxBytes: MAX_DOCUMENT_BYTES,
      accept: 'text/html',
    })
  ).toString('utf8')
  const marker = 'href="/astrale-os/ui/tree/' + ref + '"'
  const markerOffset = html.lastIndexOf(marker)
  const releaseHeader = markerOffset < 0 ? '' : html.slice(markerOffset, markerOffset + 8_192)
  const commits = new Set(
    [
      ...releaseHeader.matchAll(
        /data-hovercard-type=["']commit["'][^>]+href=["']\/astrale-os\/ui\/commit\/([0-9a-f]{40})["']/gu,
      ),
    ].map((match) => match[1]),
  )
  const commit = commits.size === 1 ? commits.values().next().value : undefined
  if (!commit) {
    throw unavailable('UI ref ' + ref + ' did not resolve to a commit.')
  }
  return commit
}

export async function readUiReleaseSnapshot(
  identity: UiReleaseIdentity,
  fetcher: Fetch = fetch,
): Promise<UiRelease> {
  const [compatibility, registry] = await Promise.all([
    json<UiCompatibility>(
      fetcher,
      RAW + '/' + identity.commit + '/tooling/compatibility.json',
      'UI compatibility metadata',
    ),
    readRegistry(identity.commit, fetcher),
  ])
  if (
    compatibility.version !== 1 ||
    compatibility.base !== 'base' ||
    compatibility.style !== 'nova' ||
    !/^\d+\.\d+\.\d+$/u.test(compatibility.shadcn)
  ) {
    throw unavailable('UI compatibility metadata is invalid.')
  }
  return { ...identity, compatibility, registry }
}

async function readRegistry(commit: string, fetcher: Fetch): Promise<UiRegistry> {
  const candidate = RAW + '/' + commit + '/registry.json'
  const root = await json<RegistrySource>(fetcher, candidate, 'UI registry')
  const items = await resolveRegistryItems(root, candidate, commit, fetcher, new Set([candidate]))
  const installable: UiRegistryItem[] = []
  const refused: UiRefusedItem[] = []
  for (const item of items) {
    if (isRecord(item) && item.type === 'registry:base') continue
    const reason = uiItemRefusal(item)
    if (reason === undefined) installable.push(item as UiRegistryItem)
    else refused.push({ ...identityOf(item), reason })
  }
  if (installable.length === 0) {
    throw unavailable('UI registry has no installable items.')
  }
  const identities = [
    ...installable.map((item) => ({ name: item.name, address: item.meta.canonicalAddress })),
    ...refused,
  ]
  for (const key of ['name', 'address'] as const) {
    const values = identities.flatMap((identity) => identity[key] ?? [])
    if (new Set(values).size !== values.length) {
      throw unavailable('UI registry contains duplicate item identities.')
    }
  }
  return { name: root.name ?? 'astrale-ui', homepage: root.homepage, items: installable, refused }
}

function identityOf(item: unknown): Omit<UiRefusedItem, 'reason'> {
  if (!isRecord(item)) return {}
  const address = isRecord(item.meta) ? item.meta.canonicalAddress : undefined
  return {
    ...(typeof item.name === 'string' ? { name: item.name } : {}),
    ...(typeof address === 'string' ? { address } : {}),
  }
}

async function resolveRegistryItems(
  source: RegistrySource,
  sourceUrl: string,
  commit: string,
  fetcher: Fetch,
  visited: Set<string>,
): Promise<unknown[]> {
  const releaseRoot = RAW + '/' + commit + '/'
  const sourceRelative = sourceUrl.slice(releaseRoot.length)
  const sourceDirectory = sourceRelative.slice(0, Math.max(0, sourceRelative.lastIndexOf('/')))
  const direct = Array.isArray(source.items)
    ? source.items.map((item) => qualifyRegistryItemPaths(item, sourceDirectory))
    : []
  const includes = source.include ?? []
  if (!Array.isArray(includes)) {
    throw unavailable('UI registry include must be an array.')
  }
  if (visited.size + includes.length > MAX_REGISTRY_DOCUMENTS) {
    throw unavailable('UI registry contains too many included documents.')
  }
  const nested = await Promise.all(
    includes.map(async (include) => {
      if (
        typeof include !== 'string' ||
        !isSafeRelative(include) ||
        !/^[A-Za-z0-9._/-]+$/u.test(include) ||
        !include.endsWith('registry.json') ||
        include === 'registry.json'
      ) {
        throw unavailable('UI registry contains an unsafe include.')
      }
      const sourceDirectoryUrl = sourceUrl.slice(0, sourceUrl.lastIndexOf('/') + 1)
      const url = new URL(include, sourceUrl).toString()
      if (
        url !== sourceDirectoryUrl + include ||
        !url.startsWith(releaseRoot) ||
        !url.startsWith(sourceDirectoryUrl) ||
        visited.has(url)
      ) {
        throw unavailable('UI registry include escaped or repeated the release snapshot.')
      }
      visited.add(url)
      const child = await json<RegistrySource>(fetcher, url, 'UI registry include')
      return resolveRegistryItems(child, url, commit, fetcher, visited)
    }),
  )
  return direct.concat(nested.flat())
}

function qualifyRegistryItemPaths(item: unknown, sourceDirectory: string): unknown {
  if (!item || typeof item !== 'object') return item
  const candidate = item as { files?: unknown }
  if (!Array.isArray(candidate.files)) return item
  return {
    ...candidate,
    files: candidate.files.map((file) => {
      if (!file || typeof file !== 'object') return file
      const candidateFile = file as { path?: unknown }
      if (typeof candidateFile.path !== 'string') return file
      if (
        !isSafeRelative(candidateFile.path) ||
        (sourceDirectory !== '' &&
          (candidateFile.path === sourceDirectory ||
            candidateFile.path.startsWith(sourceDirectory + '/')))
      ) {
        throw unavailable('UI registry contains an invalid installable item path.')
      }
      if (sourceDirectory === '') return file
      // Both parts are safe relative paths, so their join is one too.
      return { ...candidateFile, path: sourceDirectory + '/' + candidateFile.path }
    }),
  }
}

const OWNED_FOLDER = 'components/astrale/'
const THEME_FOLDER = OWNED_FOLDER + 'theme/'
const ITEM_TYPE = {
  theme: 'registry:theme',
  component: 'registry:component',
  pattern: 'registry:block',
  block: 'registry:block',
} as const
const SOURCE_FILE_TYPES = new Set([
  'registry:component',
  'registry:ui',
  'registry:lib',
  'registry:hook',
])
/** An npm package name and a version range: never a URL, path, workspace, or alias source. */
const PACKAGE_REQUIREMENT =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@[~^<>=|0-9A-Za-z.* -]+$/u

function isEmptyField(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.length === 0) ||
    (isRecord(value) && Object.keys(value).length === 0)
  )
}

/**
 * Why the CLI cannot install `item` from a release, or undefined when the item is admitted.
 *
 * An admitted item writes only consumer-owned files under `components/astrale/`, each at one safe
 * relative target that shadcn places verbatim, declares only npm package requirements, and has no
 * effect that fetches another registry item, writes environment files, or edits Tailwind config.
 */
function uiItemRefusal(item: unknown): string | undefined {
  if (!isRecord(item)) return 'the item is not an object'
  const address = isRecord(item.meta) ? item.meta.canonicalAddress : undefined
  if (typeof address !== 'string') return 'the item has no canonical address'
  if (!UI_ITEM_ADDRESS.test(address)) {
    return 'canonical address ' + address + ' is not a UI item address'
  }
  const kind = address.slice(0, address.indexOf('/')) as keyof typeof ITEM_TYPE
  if (item.name !== address.replaceAll('/', '-')) return 'name does not spell its canonical address'
  if (item.type !== ITEM_TYPE[kind]) return 'a ' + kind + ' item must have type ' + ITEM_TYPE[kind]
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const requirements = item[field]
    if (requirements === undefined) continue
    if (!Array.isArray(requirements)) return field + ' is not a list'
    const invalid = requirements.find(
      (requirement) => typeof requirement !== 'string' || !PACKAGE_REQUIREMENT.test(requirement),
    )
    if (invalid !== undefined) {
      return 'dependency ' + String(invalid) + ' is not an npm package with a version range'
    }
  }
  for (const field of ['registryDependencies', 'envVars', 'tailwind'] as const) {
    if (!isEmptyField(item[field])) return 'the item declares ' + field
  }
  const files = item.files
  if (!Array.isArray(files) || files.length === 0) return 'the item has no files'
  if (kind === 'theme' && files.length !== 1) return 'a theme has exactly one file'
  const targets = new Set<string>()
  for (const file of files as unknown[]) {
    if (!isRecord(file) || typeof file.path !== 'string' || !isSafeRelative(file.path)) {
      return 'a file has no safe source path'
    }
    const target = file.target
    if (typeof target !== 'string' || !isSafeRelative(target)) {
      return 'file ' + file.path + ' has no safe target'
    }
    if (targets.has(target)) return 'target ' + target + ' is declared twice'
    targets.add(target)
    if (kind === 'theme') {
      if (file.type !== 'registry:file') return 'a theme file must have type registry:file'
      if (target !== THEME_FOLDER + address.slice('theme/'.length) + '.css') {
        return 'theme target ' + target + ' is not its owned stylesheet'
      }
      continue
    }
    if (typeof file.type !== 'string' || !SOURCE_FILE_TYPES.has(file.type)) {
      return 'file ' + file.path + ' has unsupported type ' + String(file.type)
    }
    if (!target.startsWith(OWNED_FOLDER)) return 'target ' + target + ' is outside ' + OWNED_FOLDER
    if (target.startsWith(THEME_FOLDER)) return 'target ' + target + ' is reserved for themes'
  }
  return undefined
}

export async function readUiRegistryItem(
  release: UiRelease,
  expected: UiRegistryItem,
  fetcher: Fetch = fetch,
): Promise<UiRegistryItem> {
  const item = await json<unknown>(
    fetcher,
    registryItemUrl(release, expected.name),
    'UI registry item ' + expected.name,
  )
  const reason = uiItemRefusal(item)
  if (reason !== undefined) {
    throw unavailable('UI registry item ' + expected.name + ' is not installable: ' + reason + '.')
  }
  const admitted = item as UiRegistryItem
  if (
    admitted.name !== expected.name ||
    admitted.meta.canonicalAddress !== expected.meta.canonicalAddress ||
    admitted.files.length !== expected.files.length ||
    admitted.files.some((file, index) => {
      const declared = expected.files[index]
      return (
        typeof file.content !== 'string' ||
        file.content.length === 0 ||
        !declared ||
        file.path !== declared.path ||
        file.type !== declared.type ||
        file.target !== declared.target
      )
    })
  ) {
    throw unavailable(
      'UI registry item ' + expected.name + ' does not match the admitted release index.',
    )
  }
  if (admitted.type === 'registry:theme') {
    const refusal = themeCssRefusal(
      admitted.files[0]!.content!,
      admitted.meta.canonicalAddress.slice('theme/'.length),
    )
    if (refusal !== undefined) {
      throw unavailable(
        'UI registry item ' + expected.name + ' is not installable: ' + refusal + '.',
      )
    }
  }
  return admitted
}

export function registryItemUrl(release: UiRelease, itemName: string): string {
  return RAW + '/' + release.commit + '/registry/public/r/' + encodeURIComponent(itemName) + '.json'
}
