import { UiError, type UiCompatibility, type UiRegistry, type UiRelease } from './model'

const NPM_PACKAGE = 'https://registry.npmjs.org/@astrale-os/ui'
const GITHUB_API = 'https://api.github.com/repos/astrale-os/ui'
const GITHUB_WEB = 'https://github.com/astrale-os/ui'
const RAW = 'https://raw.githubusercontent.com/astrale-os/ui'
const MAX_DOCUMENT_BYTES = 1_048_576
const MAX_REGISTRY_DOCUMENTS = 100

type Fetch = typeof fetch
class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super('HTTP ' + status)
  }
}
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
  const body = await responseText(response, label)
  try {
    return JSON.parse(body) as T
  } catch (cause) {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', label + ' returned malformed JSON.', undefined, {
      cause,
    })
  }
}

async function responseText(response: Response, label: string): Promise<string> {
  if (!response.ok) {
    throw new UiError(
      'UI_REGISTRY_UNAVAILABLE',
      label + ' returned HTTP ' + response.status + '.',
      undefined,
      { cause: new HttpStatusError(response.status) },
    )
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOCUMENT_BYTES) {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', label + ' exceeds the supported response size.')
  }
  if (!response.body) {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', label + ' returned an empty response.')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    bytes += result.value.byteLength
    if (bytes > MAX_DOCUMENT_BYTES) {
      await reader.cancel()
      throw new UiError('UI_REGISTRY_UNAVAILABLE', label + ' exceeds the supported response size.')
    }
    chunks.push(result.value)
  }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

export async function resolveUiRelease(
  requested?: string,
  fetcher: Fetch = fetch,
): Promise<UiRelease> {
  const versionDocument = requested
    ? { version: requested.replace(/^v/u, '') }
    : await json<{ version: string }>(fetcher, NPM_PACKAGE + '/beta', 'npm UI release')
  const version = versionDocument.version
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', 'Invalid UI release version: ' + version)
  }
  if (!requested && !/-beta\.\d+$/u.test(version)) {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', 'Invalid UI beta release version: ' + version)
  }
  const ref = 'v' + version
  const commit = await resolveReleaseCommit(ref, fetcher)
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', 'UI ref ' + ref + ' did not resolve to a commit.')
  }
  return readUiReleaseSnapshot({ version, ref, commit }, fetcher)
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

  const label = 'UI release ' + ref
  let response: Response
  try {
    response = await fetcher(GITHUB_WEB + '/releases/tag/' + encodeURIComponent(ref), {
      headers: { accept: 'text/html' },
    })
  } catch (cause) {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', 'Unable to reach ' + label + '.', undefined, {
      cause,
    })
  }
  const html = await responseText(response, label)
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
    throw new UiError('UI_REGISTRY_UNAVAILABLE', 'UI ref ' + ref + ' did not resolve to a commit.')
  }
  return commit
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
    throw new UiError(
      'UI_REGISTRY_UNAVAILABLE',
      'UI registry contains an invalid installable item.',
    )
  }
  const installable = publicItems
  if (installable.length === 0) {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', 'UI registry has no installable items.')
  }
  if (
    new Set(installable.map((item) => item.name)).size !== installable.length ||
    new Set(installable.map((item) => item.meta.canonicalAddress)).size !== installable.length
  ) {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', 'UI registry contains duplicate item identities.')
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
    throw new UiError('UI_REGISTRY_UNAVAILABLE', 'UI registry include must be an array.')
  }
  if (visited.size + includes.length > MAX_REGISTRY_DOCUMENTS) {
    throw new UiError(
      'UI_REGISTRY_UNAVAILABLE',
      'UI registry contains too many included documents.',
    )
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
        throw new UiError('UI_REGISTRY_UNAVAILABLE', 'UI registry contains an unsafe include.')
      }
      const sourceDirectoryUrl = sourceUrl.slice(0, sourceUrl.lastIndexOf('/') + 1)
      const url = new URL(include, sourceUrl).toString()
      if (
        url !== sourceDirectoryUrl + include ||
        !url.startsWith(releaseRoot) ||
        !url.startsWith(sourceDirectoryUrl) ||
        visited.has(url)
      ) {
        throw new UiError(
          'UI_REGISTRY_UNAVAILABLE',
          'UI registry include escaped or repeated the release snapshot.',
        )
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
        throw new UiError(
          'UI_REGISTRY_UNAVAILABLE',
          'UI registry contains an invalid installable item path.',
        )
      }
      if (sourceDirectory === '') return file
      const qualified = sourceDirectory + '/' + candidateFile.path
      if (!isSafeRelative(qualified)) {
        throw new UiError(
          'UI_REGISTRY_UNAVAILABLE',
          'UI registry contains an invalid installable item path.',
        )
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
    throw new UiError(
      'UI_REGISTRY_UNAVAILABLE',
      'UI registry item ' + expected.name + ' does not match the admitted release index.',
    )
  }
  return item
}

function isSafeRelative(value: string): boolean {
  const segments = value.split('/')
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !/^[A-Za-z]:[\\/]/u.test(value) &&
    !value.includes('\\') &&
    !/[?#%]/u.test(value) &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code <= 31 || code === 127
    }) &&
    segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  )
}

export function registryItemUrl(release: UiRelease, itemName: string): string {
  return RAW + '/' + release.commit + '/registry/public/r/' + encodeURIComponent(itemName) + '.json'
}
