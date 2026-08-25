import { UiError, type UiCompatibility, type UiRegistry, type UiRelease } from './model'

const NPM_PACKAGE = 'https://registry.npmjs.org/@astrale-os/ui'
const GITHUB_API = 'https://api.github.com/repos/astrale-os/ui'
const RAW = 'https://raw.githubusercontent.com/astrale-os/ui'

type Fetch = typeof fetch
type RegistrySource = {
  name?: string
  homepage?: string
  include?: string[]
  items?: unknown[]
}

async function json<T>(fetcher: Fetch, url: string, label: string): Promise<T> {
  let response: Response
  try {
    response = await fetcher(url, { headers: { accept: 'application/json' } })
  } catch (cause) {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', 'Unable to reach ' + label + '.', undefined, {
      cause,
    })
  }
  if (!response.ok) {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', label + ' returned HTTP ' + response.status + '.')
  }
  return (await response.json()) as T
}

export async function resolveUiRelease(
  requested?: string,
  fetcher: Fetch = fetch,
): Promise<UiRelease> {
  const versionDocument = requested
    ? { version: requested.replace(/^v/u, '') }
    : await json<{ version: string }>(fetcher, NPM_PACKAGE + '/latest', 'npm UI release')
  const version = versionDocument.version
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', 'Invalid UI release version: ' + version)
  }
  const ref = 'v' + version
  const reference = await json<{
    object: { type: 'commit' | 'tag'; sha: string; url: string }
  }>(fetcher, GITHUB_API + '/git/ref/tags/' + encodeURIComponent(ref), 'UI ref ' + ref)
  const commit =
    reference.object.type === 'commit'
      ? reference.object.sha
      : (
          await json<{ object: { sha: string } }>(
            fetcher,
            reference.object.url,
            'annotated UI tag ' + ref,
          )
        ).object.sha
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', 'UI ref ' + ref + ' did not resolve to a commit.')
  }
  return readUiReleaseSnapshot({ version, ref, commit }, fetcher)
}

export async function readUiReleaseSnapshot(
  identity: Pick<UiRelease, 'version' | 'ref' | 'commit'>,
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
    throw new UiError('UI_REGISTRY_UNAVAILABLE', 'UI compatibility metadata is invalid.')
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
    throw new Error('UI registry contains an invalid installable item.')
  }
  const installable = publicItems
  if (installable.length === 0) throw new Error('UI registry has no installable items.')
  if (
    new Set(installable.map((item) => item.name)).size !== installable.length ||
    new Set(installable.map((item) => item.meta.canonicalAddress)).size !== installable.length
  ) {
    throw new Error('UI registry contains duplicate item identities.')
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
  const direct = Array.isArray(source.items) ? source.items : []
  const includes = source.include ?? []
  if (!Array.isArray(includes)) throw new Error('UI registry include must be an array.')
  const nested = await Promise.all(
    includes.map(async (include) => {
      if (
        typeof include !== 'string' ||
        include.startsWith('/') ||
        !include.endsWith('registry.json') ||
        include.split('/').includes('..')
      ) {
        throw new Error('UI registry contains an unsafe include.')
      }
      const url = new URL(include, sourceUrl).toString()
      const releaseRoot = RAW + '/' + commit + '/'
      if (!url.startsWith(releaseRoot) || visited.has(url)) {
        throw new Error('UI registry include escaped or repeated the release snapshot.')
      }
      visited.add(url)
      const child = await json<RegistrySource>(fetcher, url, 'UI registry include')
      return resolveRegistryItems(child, url, commit, fetcher, visited)
    }),
  )
  return direct.concat(nested.flat())
}

function isInstallableItem(item: unknown): item is UiRegistry['items'][number] {
  if (!item || typeof item !== 'object') return false
  const candidate = item as Partial<UiRegistry['items'][number]>
  return (
    typeof candidate.name === 'string' &&
    /^(?:pattern|block)-[a-z0-9-]+$/u.test(candidate.name) &&
    candidate.type === 'registry:block' &&
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
        isSafeRelative(file.target),
    ) &&
    typeof candidate.meta?.canonicalAddress === 'string' &&
    /^(?:pattern|block)\/[a-z0-9-]+\/[a-z0-9-/]+$/u.test(candidate.meta.canonicalAddress)
  )
}

function isSafeRelative(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:[\\/]/u.test(value) &&
    !value.includes('\\') &&
    !value.split('/').includes('..')
  )
}

export function registryItemUrl(release: UiRelease, itemName: string): string {
  return RAW + '/' + release.commit + '/registry/public/r/' + encodeURIComponent(itemName) + '.json'
}
