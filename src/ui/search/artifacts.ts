import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { atomicWrite, withFileLock } from '../../state/files'
import { UiError, type UiReleaseIdentity } from '../model'
import {
  SEARCH_LIMITS,
  acceptArtifactFile,
  acceptSearchManifest,
  type SearchArtifactFile,
  type SearchCode,
  type SearchManifest,
} from './model'

const RAW = 'https://raw.githubusercontent.com/astrale-os/ui'

export type SearchArtifactDependencies = {
  fetcher?: typeof fetch
  cacheRoot?: string
}

export type SearchArtifacts = {
  manifest: SearchManifest
  readJson(file: SearchArtifactFile): Promise<unknown>
  readCode(code: SearchCode): Promise<string>
}

function cacheBase(commit: string, configured?: string): string {
  const home = process.env.ASTRALE_HOME ?? path.join(homedir(), '.astrale')
  return path.join(configured ?? path.join(home, 'cache', 'ui-search'), commit)
}

function cacheFile(root: string, relative: string): string {
  if (
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw new UiError('UI_SEARCH_UNAVAILABLE', 'Astrale UI search referenced an unsafe cache path.')
  }
  const target = path.resolve(root, relative)
  const fromRoot = path.relative(root, target)
  if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw new UiError('UI_SEARCH_UNAVAILABLE', 'Astrale UI search referenced an unsafe cache path.')
  }
  return target
}

async function responseBytes(response: Response, label: string, maximum: number): Promise<Buffer> {
  if (!response.ok) {
    throw new UiError('UI_SEARCH_UNAVAILABLE', `${label} returned HTTP ${response.status}.`)
  }
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximum) {
    throw new UiError('UI_SEARCH_UNAVAILABLE', `${label} exceeds the supported response size.`)
  }
  if (!response.body) throw new UiError('UI_SEARCH_UNAVAILABLE', `${label} returned no body.`)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    bytes += result.value.byteLength
    if (bytes > maximum) {
      await reader.cancel()
      throw new UiError('UI_SEARCH_UNAVAILABLE', `${label} exceeds the supported response size.`)
    }
    chunks.push(result.value)
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    bytes,
  )
}

async function fetchBytes(fetcher: typeof fetch, url: string, label: string, maximum: number) {
  let response: Response
  try {
    response = await fetcher(url, { headers: { accept: 'application/json, text/plain' } })
  } catch (cause) {
    throw new UiError('UI_SEARCH_UNAVAILABLE', `Unable to reach ${label}.`, undefined, { cause })
  }
  return responseBytes(response, label, maximum)
}

function verify(bytes: Buffer, file: SearchArtifactFile): boolean {
  return (
    bytes.byteLength === file.bytes &&
    createHash('sha256').update(bytes).digest('hex') === file.sha256
  )
}

async function readVerifiedCache(
  target: string,
  file: SearchArtifactFile,
): Promise<Buffer | undefined> {
  const bytes = await readFile(target).catch(() => undefined)
  return bytes && verify(bytes, file) ? bytes : undefined
}

async function readManifestCache(target: string): Promise<SearchManifest | undefined> {
  try {
    return acceptSearchManifest(JSON.parse(await readFile(target, 'utf8')))
  } catch {
    return undefined
  }
}

export async function loadSearchArtifacts(
  identity: UiReleaseIdentity,
  dependencies: SearchArtifactDependencies = {},
): Promise<SearchArtifacts> {
  const fetcher = dependencies.fetcher ?? fetch
  const root = cacheBase(identity.commit, dependencies.cacheRoot)
  const manifestPath = cacheFile(root, 'manifest.json')
  let manifest = await readManifestCache(manifestPath)
  if (!manifest) {
    manifest = await withFileLock(cacheFile(root, 'manifest.lock'), async () => {
      const admitted = await readManifestCache(manifestPath)
      if (admitted) return admitted
      const bytes = await fetchBytes(
        fetcher,
        `${RAW}/${identity.commit}/search/public/manifest.json`,
        'Astrale UI search manifest',
        SEARCH_LIMITS.maxManifestBytes,
      )
      let value: unknown
      try {
        value = JSON.parse(bytes.toString('utf8'))
      } catch (cause) {
        throw new UiError(
          'UI_SEARCH_UNAVAILABLE',
          'Astrale UI search manifest returned malformed JSON.',
          undefined,
          { cause },
        )
      }
      const accepted = acceptSearchManifest(value)
      await atomicWrite(manifestPath, bytes.toString('utf8'))
      return accepted
    })
  }

  const readArtifact = async (
    descriptor: SearchArtifactFile,
    kind: 'artifact' | 'code' = 'artifact',
  ): Promise<Buffer> => {
    const file = kind === 'artifact' ? acceptArtifactFile(descriptor) : descriptor
    const target = cacheFile(root, kind === 'artifact' ? file.path : `code/${file.path}`)
    const cached = await readVerifiedCache(target, file)
    if (cached) return cached
    return withFileLock(cacheFile(root, `locks/${file.sha256}.lock`), async () => {
      const admitted = await readVerifiedCache(target, file)
      if (admitted) return admitted
      const bytes = await fetchBytes(
        fetcher,
        `${RAW}/${identity.commit}/${file.path}`,
        'Astrale UI search artifact',
        Math.min(
          file.bytes + 1,
          kind === 'artifact' ? SEARCH_LIMITS.maxArtifactBytes : SEARCH_LIMITS.maxCodeBytes,
        ),
      )
      if (!verify(bytes, file)) {
        throw new UiError(
          'UI_SEARCH_UNAVAILABLE',
          'Astrale UI search artifact failed integrity admission.',
        )
      }
      await atomicWrite(target, bytes.toString('utf8'))
      return bytes
    })
  }

  return {
    manifest,
    async readJson(file) {
      const bytes = await readArtifact(file)
      try {
        return JSON.parse(bytes.toString('utf8'))
      } catch (cause) {
        throw new UiError(
          'UI_SEARCH_UNAVAILABLE',
          'Astrale UI search artifact contains malformed JSON.',
          undefined,
          { cause },
        )
      }
    },
    async readCode(code) {
      const file = { path: code.path, bytes: code.bytes, sha256: code.sha256 }
      const bytes = await readArtifact(file, 'code')
      return bytes.toString('utf8')
    },
  }
}
