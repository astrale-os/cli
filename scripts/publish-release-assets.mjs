import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_ATTEMPTS = 3
export const CLI_RELEASE_ASSETS = [
  'astrale-darwin-arm64.tar.gz',
  'astrale-darwin-x64.tar.gz',
  'astrale-linux-arm64.tar.gz',
  'astrale-linux-x64.tar.gz',
  'manifest.json',
  'sha256sums.txt',
]

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function runGh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

export async function localAssets(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile())
    .sort((a, b) => a.name.localeCompare(b.name))
  if (files.length === 0) throw new Error(`release asset directory is empty: ${directory}`)

  const assets = []
  for (const { name } of files) {
    const path = join(directory, name)
    const metadata = await stat(path)
    if (metadata.size === 0) throw new Error(`release asset is empty: ${name}`)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    assets.push({
      name,
      path,
      size: metadata.size,
      digest: `sha256:${hash.digest('hex')}`,
    })
  }
  return assets
}

function jsonResult(result, description) {
  if (result.status !== 0) {
    throw new Error(`${description}: ${result.stderr.trim() || 'gh failed'}`)
  }
  try {
    return JSON.parse(result.stdout)
  } catch (cause) {
    throw new Error(`${description}: invalid JSON`, { cause })
  }
}

export function resolveReleaseTagCommit({ tag, repository, gh = runGh }) {
  if (!tag || !repository) throw new TypeError('release tag and repository are required')
  let object = jsonResult(
    gh(['api', `repos/${repository}/git/ref/tags/${tag}`]),
    `could not inspect release tag ${tag}`,
  ).object
  for (let depth = 0; depth < 8; depth += 1) {
    if (object?.type === 'commit' && typeof object.sha === 'string') return object.sha
    if (object?.type !== 'tag' || typeof object.sha !== 'string') {
      throw new Error(`release tag ${tag} does not resolve to a commit`)
    }
    object = jsonResult(
      gh(['api', `repos/${repository}/git/tags/${object.sha}`]),
      `could not dereference release tag ${tag}`,
    ).object
  }
  throw new Error(`release tag ${tag} exceeds the supported annotation depth`)
}

export function verifyReleaseTagCommit({ tag, expectedCommit, repository, gh = runGh }) {
  const tagCommit = resolveReleaseTagCommit({ tag, repository, gh })
  if (tagCommit !== expectedCommit) {
    throw new Error(
      `immutable release tag ${tag} resolves to ${tagCommit}, expected ${expectedCommit}`,
    )
  }
}

async function remoteAssets(tag, gh, attempts, delay) {
  let lastFailure = 'gh failed'
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = gh(['release', 'view', tag, '--json', 'assets'])
    if (result.status === 0) {
      const document = jsonResult(result, `release ${tag} returned invalid asset metadata`)
      if (!Array.isArray(document.assets)) {
        throw new Error(`release ${tag} did not return an asset array`)
      }
      return new Map(document.assets.map((asset) => [asset.name, asset]))
    }
    lastFailure = result.stderr.trim() || 'gh failed'
    if (attempt < attempts) await delay(attempt * 2_000)
  }
  throw new Error(`could not inspect release ${tag} after ${attempts} attempts: ${lastFailure}`)
}

async function observedAsset({ tag, asset, gh, attempts, delay }) {
  for (let observation = 1; observation <= attempts; observation += 1) {
    const retained = (await remoteAssets(tag, gh, attempts, delay)).get(asset.name)
    if (exactAsset(asset, retained) || observation === attempts) return retained
    await delay(observation * 2_000)
  }
  return undefined
}

function exactAsset(local, remote) {
  return remote?.size === local.size && remote?.digest === local.digest
}

export async function validateCliReleaseClosure(directory, assets, expected = {}) {
  const archives = assets.filter(({ name }) => name.startsWith('astrale-'))
  const archiveByName = new Map(archives.map((asset) => [asset.name, asset]))
  const checksums = (await readFile(join(directory, 'sha256sums.txt'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => {
      const match = /^([a-f0-9]{64})  (astrale-[^/]+\.tar\.gz)$/u.exec(line)
      if (!match) throw new Error(`release checksum line is invalid: ${line}`)
      return { digest: `sha256:${match[1]}`, name: match[2] }
    })
  if (checksums.length !== archives.length) {
    throw new Error('release checksum closure does not match the platform archive closure')
  }
  for (const checksum of checksums) {
    const archive = archiveByName.get(checksum.name)
    if (!archive || archive.digest !== checksum.digest) {
      throw new Error(`release checksum does not match ${checksum.name}`)
    }
    archiveByName.delete(checksum.name)
  }
  if (archiveByName.size !== 0) throw new Error('release checksum closure is incomplete')

  let manifest
  try {
    manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  } catch (cause) {
    throw new Error('release manifest is not valid JSON', { cause })
  }
  if (manifest.schemaVersion !== 2) {
    throw new Error('release manifest schemaVersion is invalid')
  }
  for (const field of ['version', 'binaryVersion', 'cloudflaredVersion', 'channel', 'repo']) {
    if (typeof manifest[field] !== 'string' || manifest[field].length === 0) {
      throw new Error(`release manifest field is invalid: ${field}`)
    }
  }
  for (const [field, value] of Object.entries(expected)) {
    if (value !== undefined && manifest[field] !== value) {
      throw new Error(`release manifest ${field} does not match ${value}`)
    }
  }
  if (!manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) {
    throw new Error('release manifest assets are invalid')
  }
  const platforms = Object.keys(manifest.assets).sort((a, b) => a.localeCompare(b))
  const expectedPlatforms = archives
    .map(({ name }) => name.slice('astrale-'.length, -'.tar.gz'.length))
    .sort((a, b) => a.localeCompare(b))
  if (JSON.stringify(platforms) !== JSON.stringify(expectedPlatforms)) {
    throw new Error('release manifest platform closure is invalid')
  }
  for (const platform of platforms) {
    const archive = archives.find(({ name }) => name === `astrale-${platform}.tar.gz`)
    const entry = manifest.assets[platform]
    if (
      !archive ||
      entry?.name !== archive.name ||
      `sha256:${entry?.sha256 ?? ''}` !== archive.digest
    ) {
      throw new Error(`release manifest does not match ${platform}`)
    }
  }
}

async function uploadOne({ tag, asset, mutable, attempts, gh, delay }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const before = (await remoteAssets(tag, gh, attempts, delay)).get(asset.name)
    if (exactAsset(asset, before)) return
    if (before && !mutable) {
      throw new Error(
        `immutable release ${tag} has conflicting asset ${asset.name}: ` +
          `expected ${asset.digest} (${asset.size} bytes), got ${before.digest ?? 'no digest'} ` +
          `(${before.size ?? 'unknown'} bytes)`,
      )
    }

    const args = ['release', 'upload', tag, asset.path]
    if (mutable) args.push('--clobber')
    const uploaded = gh(args)
    const after = await observedAsset({ tag, asset, gh, attempts, delay })
    if (exactAsset(asset, after)) return

    if (uploaded.status === 0) {
      throw new Error(`release ${tag} did not retain the exact uploaded asset ${asset.name}`)
    }
    if (after && !mutable) {
      throw new Error(`immutable release ${tag} retained a conflicting asset ${asset.name}`)
    }
    if (attempt === attempts) {
      throw new Error(
        `could not upload ${asset.name} to ${tag} after ${attempts} attempts: ` +
          (uploaded.stderr.trim() || 'gh failed'),
      )
    }
    await delay(attempt * 5_000)
  }
}

export async function publishReleaseAssets({
  tag,
  directory,
  mutable = false,
  attempts = DEFAULT_ATTEMPTS,
  requiredAssets,
  expectedCommit,
  expectedManifest,
  repository,
  gh = runGh,
  delay = wait,
}) {
  if (!tag) throw new TypeError('release tag is required')
  if (!directory) throw new TypeError('release asset directory is required')
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new TypeError('release upload attempts must be a positive integer')
  }
  if (expectedCommit) {
    verifyReleaseTagCommit({ tag, expectedCommit, repository, gh })
  }

  const assets = await localAssets(directory)
  if (requiredAssets) {
    const actual = assets.map(({ name }) => name)
    const required = [...requiredAssets].sort((a, b) => a.localeCompare(b))
    if (JSON.stringify(actual) !== JSON.stringify(required)) {
      throw new Error(
        `release asset closure is invalid: expected ${required.join(', ')}, got ${actual.join(', ')}`,
      )
    }
  }
  if (requiredAssets === CLI_RELEASE_ASSETS) {
    await validateCliReleaseClosure(directory, assets, expectedManifest)
  }

  const initial = await remoteAssets(tag, gh, attempts, delay)

  const localNames = new Set(assets.map(({ name }) => name))
  for (const name of initial.keys()) {
    if (!localNames.has(name)) {
      throw new Error(`release ${tag} has unexpected asset ${name}`)
    }
  }
  if (!mutable) {
    for (const asset of assets) {
      const existing = initial.get(asset.name)
      if (existing && !exactAsset(asset, existing)) {
        throw new Error(
          `immutable release ${tag} has conflicting asset ${asset.name}: ` +
            `expected ${asset.digest} (${asset.size} bytes), got ` +
            `${existing.digest ?? 'no digest'} (${existing.size ?? 'unknown'} bytes)`,
        )
      }
    }
  }

  for (const asset of assets) {
    await uploadOne({ tag, asset, mutable, attempts, gh, delay })
  }

  const retained = await remoteAssets(tag, gh, attempts, delay)
  if (retained.size !== assets.length) {
    throw new Error(`release ${tag} retained an unexpected final asset closure`)
  }
  for (const asset of assets) {
    if (!exactAsset(asset, retained.get(asset.name))) {
      throw new Error(`release ${tag} is missing exact asset ${asset.name} after publication`)
    }
  }
}

async function main(argv) {
  if (argv[0] === '--verify-tag') {
    const [, tag, expectedCommit] = argv
    const repository = process.env.GITHUB_REPOSITORY
    if (!tag || !expectedCommit || argv.length !== 3 || !repository) {
      throw new TypeError(
        'usage: GITHUB_REPOSITORY=<owner/repo> node scripts/publish-release-assets.mjs --verify-tag <tag> <commit>',
      )
    }
    verifyReleaseTagCommit({ tag, expectedCommit, repository })
    return
  }
  const mutable = argv[0] === '--mutable'
  const offset = mutable ? 1 : 0
  const tag = argv[offset]
  const directory = argv[offset + 1]
  if (!tag || !directory || argv.length !== offset + 2) {
    throw new TypeError(
      'usage: node scripts/publish-release-assets.mjs [--mutable] <tag> <asset-directory>',
    )
  }
  const version = process.env.VERSION
  const binaryVersion = process.env.BINARY_VERSION
  const cloudflaredVersion = process.env.CLOUDFLARED_VERSION
  const channel = process.env.CHANNEL
  const repository = process.env.GITHUB_REPOSITORY
  const expectedCommit = process.env.EXPECTED_COMMIT
  if (
    !version ||
    !binaryVersion ||
    !cloudflaredVersion ||
    !channel ||
    !repository ||
    !expectedCommit
  ) {
    throw new TypeError(
      'VERSION, BINARY_VERSION, CLOUDFLARED_VERSION, CHANNEL, GITHUB_REPOSITORY, and EXPECTED_COMMIT are required',
    )
  }
  await publishReleaseAssets({
    tag,
    directory,
    mutable,
    requiredAssets: CLI_RELEASE_ASSETS,
    expectedCommit: mutable ? undefined : expectedCommit,
    expectedManifest: {
      version,
      binaryVersion,
      cloudflaredVersion,
      channel,
      repo: repository,
    },
    repository,
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((cause) => {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  })
}
