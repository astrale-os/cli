import { fetchBounded, fetchJson, HttpStatusError } from './fetch'
import { isSafeRelative } from './files'
import {
  RELEASE_VERSION,
  UiError,
  type UiCompatibility,
  type UiRegistry,
  type UiRelease,
  type UiReleaseIdentity,
} from './model'

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
  const publicItems = items.filter(
    (item) =>
      !(item && typeof item === 'object' && (item as { type?: unknown }).type === 'registry:base'),
  )
  if (!publicItems.every(isInstallableItem)) {
    throw unavailable('UI registry contains an invalid installable item.')
  }
  const installable = publicItems
  if (installable.length === 0) {
    throw unavailable('UI registry has no installable items.')
  }
  if (
    new Set(installable.map((item) => item.name)).size !== installable.length ||
    new Set(installable.map((item) => item.meta.canonicalAddress)).size !== installable.length
  ) {
    throw unavailable('UI registry contains duplicate item identities.')
  }
  return { name: root.name ?? 'astrale-ui', homepage: root.homepage, items: installable }
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
      const qualified = sourceDirectory + '/' + candidateFile.path
      if (!isSafeRelative(qualified)) {
        throw unavailable('UI registry contains an invalid installable item path.')
      }
      return { ...candidateFile, path: qualified }
    }),
  }
}

function isInstallableItem(item: unknown): item is UiRegistry['items'][number] {
  if (!item || typeof item !== 'object') return false
  const candidate = item as Partial<UiRegistry['items'][number]>
  const address = candidate.meta?.canonicalAddress
  const isTheme =
    candidate.type === 'registry:theme' &&
    typeof candidate.name === 'string' &&
    /^theme-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(candidate.name) &&
    typeof address === 'string' &&
    /^theme\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(address)
  const isComposition =
    candidate.type === 'registry:block' &&
    typeof candidate.name === 'string' &&
    /^(?:pattern|block)-[a-z0-9-]+$/u.test(candidate.name) &&
    typeof address === 'string' &&
    /^(?:pattern|block)\/[a-z0-9-]+\/[a-z0-9-/]+$/u.test(address)
  const isComponent =
    candidate.type === 'registry:component' &&
    typeof candidate.name === 'string' &&
    /^component-[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(candidate.name) &&
    typeof address === 'string' &&
    /^component\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(address)
  return (
    (isTheme || isComposition || isComponent) &&
    (candidate.dependencies === undefined ||
      (Array.isArray(candidate.dependencies) &&
        candidate.dependencies.every(
          (dependency) =>
            typeof dependency === 'string' &&
            /^(?:@[a-z0-9-]+\/)?[a-z0-9-]+@[~^<>=0-9A-Za-z.* -]+$/u.test(dependency),
        ))) &&
    Array.isArray(candidate.files) &&
    candidate.files.length > 0 &&
    candidate.files.every(
      (file) =>
        file &&
        typeof file.path === 'string' &&
        isSafeRelative(file.path) &&
        typeof file.type === 'string' &&
        typeof file.target === 'string' &&
        file.target.startsWith('components/astrale/') &&
        isSafeRelative(file.target) &&
        (!isTheme ||
          (candidate.files?.length === 1 &&
            file.type === 'registry:file' &&
            file.target ===
              'components/astrale/theme/' + address!.slice('theme/'.length) + '.css')) &&
        (!isComponent || file.target.startsWith('components/astrale/component/')),
    ) &&
    typeof address === 'string'
  )
}

export async function readUiRegistryItem(
  release: UiRelease,
  expected: UiRegistry['items'][number],
  fetcher: Fetch = fetch,
): Promise<UiRegistry['items'][number]> {
  const item = await json<unknown>(
    fetcher,
    registryItemUrl(release, expected.name),
    'UI registry item ' + expected.name,
  )
  if (
    !isInstallableItem(item) ||
    item.name !== expected.name ||
    item.meta.canonicalAddress !== expected.meta.canonicalAddress ||
    item.files.length !== expected.files.length ||
    item.files.some((file, index) => {
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
  return item
}

export function registryItemUrl(release: UiRelease, itemName: string): string {
  return RAW + '/' + release.commit + '/registry/public/r/' + encodeURIComponent(itemName) + '.json'
}
