import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  CLI_RELEASE_ASSETS,
  publishReleaseAssets,
  resolveReleaseTagCommit,
  validateCliReleaseClosure,
} from './publish-release-assets.mjs'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'astrale-release-assets-'))
  await writeFile(join(directory, 'astrale-darwin-arm64.tar.gz'), 'darwin')
  await writeFile(join(directory, 'manifest.json'), '{}')
  return directory
}

async function completeFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'astrale-complete-release-assets-'))
  const archives = CLI_RELEASE_ASSETS.filter((name) => name.startsWith('astrale-'))
  const entries = []
  const checksums = []
  for (const name of archives) {
    const content = `content:${name}`
    const sha256 = createHash('sha256').update(content).digest('hex')
    await writeFile(join(directory, name), content)
    checksums.push(`${sha256}  ${name}`)
    const platform = name.slice('astrale-'.length, -'.tar.gz'.length)
    entries.push([platform, { name, sha256 }])
  }
  await writeFile(join(directory, 'sha256sums.txt'), `${checksums.join('\n')}\n`)
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({
      version: '1.0.0-beta.35',
      binaryVersion: '1.0.0-beta.35',
      channel: 'beta',
      repo: 'astrale-os/cli',
      assets: Object.fromEntries(entries),
    }),
  )
  return directory
}

async function fixtureAssets(directory, names = CLI_RELEASE_ASSETS) {
  return Promise.all(
    names.map(async (name) => {
      const content = await readFile(join(directory, name))
      return {
        name,
        digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
      }
    }),
  )
}

function fakeGh({
  failures = new Map(),
  initial = [],
  corruptUploads = new Set(),
  viewFailures = 0,
  visibilityDelays = new Map(),
} = {}) {
  const assets = new Map(initial.map((asset) => [asset.name, asset]))
  const pending = new Map()
  const uploads = []
  const command = (args) => {
    if (args[0] === 'release' && args[1] === 'view') {
      if (viewFailures > 0) {
        viewFailures -= 1
        return { status: 1, stdout: '', stderr: 'temporary inspection failure' }
      }
      for (const [name, retained] of pending) {
        if (retained.remaining === 0) {
          assets.set(name, retained.asset)
          pending.delete(name)
        } else {
          retained.remaining -= 1
        }
      }
      return { status: 0, stdout: JSON.stringify({ assets: [...assets.values()] }), stderr: '' }
    }
    assert.equal(args[0], 'release')
    assert.equal(args[1], 'upload')
    const path = args[3]
    const name = path.split('/').at(-1)
    uploads.push({ name, clobber: args.includes('--clobber') })
    const remaining = failures.get(name) ?? 0
    if (remaining > 0) {
      failures.set(name, remaining - 1)
      return { status: 1, stdout: '', stderr: 'HTTP 400' }
    }
    const bytes = name === 'manifest.json' ? '{}' : 'darwin'
    const digest =
      name === 'manifest.json'
        ? 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
        : 'sha256:26ce1a1580f693873b6268fef54c5f0d0607f2896cad02ce2894c0c899a11575'
    const retained = {
      name,
      size: bytes.length,
      digest: corruptUploads.has(name) ? 'sha256:corrupt' : digest,
    }
    const visibilityDelay = visibilityDelays.get(name) ?? 0
    if (visibilityDelay === 0) assets.set(name, retained)
    else pending.set(name, { asset: retained, remaining: visibilityDelay })
    return { status: 0, stdout: '', stderr: '' }
  }
  return { command, assets, uploads }
}

describe('release asset publication', () => {
  it('uploads immutable assets sequentially and retries a transient failure', async () => {
    const directory = await fixture()
    const gh = fakeGh({ failures: new Map([['astrale-darwin-arm64.tar.gz', 1]]) })
    const delays = []

    await publishReleaseAssets({
      tag: 'cli/v1.0.0-beta.35',
      directory,
      gh: gh.command,
      delay: async (milliseconds) => delays.push(milliseconds),
    })

    assert.deepEqual(
      gh.uploads.map(({ name }) => name),
      ['astrale-darwin-arm64.tar.gz', 'astrale-darwin-arm64.tar.gz', 'manifest.json'],
    )
    assert.deepEqual(delays, [2_000, 4_000, 5_000])
    assert.equal(
      gh.uploads.every(({ clobber }) => !clobber),
      true,
    )
  })

  it('resumes an exact immutable asset without uploading it again', async () => {
    const directory = await fixture()
    const gh = fakeGh({
      initial: [
        {
          name: 'astrale-darwin-arm64.tar.gz',
          size: 6,
          digest: 'sha256:26ce1a1580f693873b6268fef54c5f0d0607f2896cad02ce2894c0c899a11575',
        },
      ],
    })

    await publishReleaseAssets({ tag: 'cli/v1.0.0-beta.35', directory, gh: gh.command })
    assert.deepEqual(
      gh.uploads.map(({ name }) => name),
      ['manifest.json'],
    )
  })

  it('rejects a conflicting immutable asset without clobbering it', async () => {
    const directory = await fixture()
    const gh = fakeGh({
      initial: [{ name: 'manifest.json', size: 2, digest: 'sha256:wrong' }],
    })

    await assert.rejects(
      publishReleaseAssets({ tag: 'cli/v1.0.0-beta.35', directory, gh: gh.command }),
      /immutable release .* conflicting asset/u,
    )
    assert.equal(gh.uploads.length, 0)
  })

  it('clobbers and verifies assets on a mutable channel', async () => {
    const directory = await fixture()
    const gh = fakeGh({ initial: [{ name: 'manifest.json', size: 2, digest: 'sha256:old' }] })

    await publishReleaseAssets({ tag: 'beta', directory, mutable: true, gh: gh.command })
    assert.deepEqual(
      gh.uploads.map(({ name }) => name),
      ['astrale-darwin-arm64.tar.gz', 'manifest.json'],
    )
    assert.equal(
      gh.uploads.every(({ clobber }) => clobber),
      true,
    )
  })

  it('rejects a successful upload when the remote digest is not exact', async () => {
    const directory = await fixture()
    const gh = fakeGh({ corruptUploads: new Set(['astrale-darwin-arm64.tar.gz']) })

    await assert.rejects(
      publishReleaseAssets({
        tag: 'beta',
        directory,
        mutable: true,
        gh: gh.command,
        delay: async () => {},
      }),
      /did not retain the exact uploaded asset/u,
    )
    assert.deepEqual(
      gh.uploads.map(({ name }) => name),
      ['astrale-darwin-arm64.tar.gz'],
    )
  })

  it('retries transient inspections and admits delayed exact upload visibility once', async () => {
    const directory = await fixture()
    const gh = fakeGh({
      viewFailures: 1,
      visibilityDelays: new Map([['astrale-darwin-arm64.tar.gz', 1]]),
    })
    const delays = []

    await publishReleaseAssets({
      tag: 'cli/v1.0.0-beta.35',
      directory,
      gh: gh.command,
      delay: async (milliseconds) => delays.push(milliseconds),
    })

    assert.equal(gh.uploads.filter(({ name }) => name === 'astrale-darwin-arm64.tar.gz').length, 1)
    assert.equal(delays.includes(2_000), true)
  })

  it('rejects an incomplete required local asset closure before uploading', async () => {
    const directory = await fixture()
    const gh = fakeGh()

    await assert.rejects(
      publishReleaseAssets({
        tag: 'cli/v1.0.0-beta.35',
        directory,
        requiredAssets: ['astrale-darwin-arm64.tar.gz', 'manifest.json', 'sha256sums.txt'],
        gh: gh.command,
      }),
      /release asset closure is invalid/u,
    )
    assert.equal(gh.uploads.length, 0)
  })

  it('fails closed when the remote release has an unexpected asset', async () => {
    const directory = await fixture()
    const gh = fakeGh({
      initial: [{ name: 'obsolete.tar.gz', size: 1, digest: 'sha256:obsolete' }],
    })

    await assert.rejects(
      publishReleaseAssets({ tag: 'cli/v1.0.0-beta.35', directory, gh: gh.command }),
      /release .* unexpected asset/u,
    )
    assert.equal(gh.uploads.length, 0)
  })

  it('admits one internally coherent CLI release closure', async () => {
    const directory = await completeFixture()
    const assets = await fixtureAssets(directory)
    await validateCliReleaseClosure(directory, assets, {
      version: '1.0.0-beta.35',
      binaryVersion: '1.0.0-beta.35',
      channel: 'beta',
      repo: 'astrale-os/cli',
    })
  })

  it('admits a canary release identity distinct from its compiled binary version', async () => {
    const directory = await completeFixture()
    const assets = await fixtureAssets(directory)
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
    manifest.version = 'main-1234567890ab'
    manifest.channel = 'canary'
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))

    await validateCliReleaseClosure(directory, assets, {
      version: 'main-1234567890ab',
      binaryVersion: '1.0.0-beta.35',
      channel: 'canary',
      repo: 'astrale-os/cli',
    })
  })

  it('rejects unsupported release formats', async () => {
    const directory = await completeFixture()
    const manifestPath = join(directory, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.schemaVersion = 2
    await writeFile(manifestPath, JSON.stringify(manifest))
    const assets = await fixtureAssets(directory)
    await assert.rejects(validateCliReleaseClosure(directory, assets), /schemaVersion is invalid/u)
  })

  it('rejects checksum and manifest closures that disagree with platform archives', async () => {
    const checksumDirectory = await completeFixture()
    const assets = CLI_RELEASE_ASSETS.map((name) => ({
      name,
      digest: name.startsWith('astrale-') ? 'sha256:expected' : 'sha256:metadata',
    }))
    await writeFile(
      join(checksumDirectory, 'sha256sums.txt'),
      `${'0'.repeat(64)}  astrale-darwin-arm64.tar.gz\n`,
    )
    await assert.rejects(
      validateCliReleaseClosure(checksumDirectory, assets),
      /checksum closure does not match/u,
    )

    const manifestDirectory = await completeFixture()
    const archiveAssets = await fixtureAssets(manifestDirectory)
    const manifest = JSON.parse(await readFile(join(manifestDirectory, 'manifest.json'), 'utf8'))
    manifest.assets['darwin-arm64'].sha256 = '0'.repeat(64)
    await writeFile(join(manifestDirectory, 'manifest.json'), JSON.stringify(manifest))
    await assert.rejects(
      validateCliReleaseClosure(manifestDirectory, archiveAssets),
      /manifest does not match darwin-arm64/u,
    )
  })

  it('rejects wrong release identity, schema, missing platforms, and duplicate checksums', async () => {
    const identityDirectory = await completeFixture()
    const identityAssets = await fixtureAssets(identityDirectory)
    await assert.rejects(
      validateCliReleaseClosure(identityDirectory, identityAssets, { version: '1.0.0-beta.99' }),
      /manifest version does not match/u,
    )

    const schemaDirectory = await completeFixture()
    const schemaAssets = await fixtureAssets(schemaDirectory)
    const schemaManifest = JSON.parse(
      await readFile(join(schemaDirectory, 'manifest.json'), 'utf8'),
    )
    schemaManifest.schemaVersion = 3
    await writeFile(join(schemaDirectory, 'manifest.json'), JSON.stringify(schemaManifest))
    await assert.rejects(
      validateCliReleaseClosure(schemaDirectory, schemaAssets),
      /manifest schemaVersion is invalid/u,
    )

    const platformDirectory = await completeFixture()
    const platformAssets = await fixtureAssets(platformDirectory)
    const platformManifest = JSON.parse(
      await readFile(join(platformDirectory, 'manifest.json'), 'utf8'),
    )
    delete platformManifest.assets['linux-x64']
    await writeFile(join(platformDirectory, 'manifest.json'), JSON.stringify(platformManifest))
    await assert.rejects(
      validateCliReleaseClosure(platformDirectory, platformAssets),
      /manifest platform closure is invalid/u,
    )

    const duplicateDirectory = await completeFixture()
    const duplicateAssets = await fixtureAssets(duplicateDirectory)
    const lines = (await readFile(join(duplicateDirectory, 'sha256sums.txt'), 'utf8'))
      .trim()
      .split('\n')
    lines[3] = lines[0]
    await writeFile(join(duplicateDirectory, 'sha256sums.txt'), `${lines.join('\n')}\n`)
    await assert.rejects(
      validateCliReleaseClosure(duplicateDirectory, duplicateAssets),
      /checksum does not match/u,
    )
  })

  it('dereferences annotated release tags to one exact commit', () => {
    const calls = []
    const gh = (args) => {
      calls.push(args)
      const path = args[1]
      if (path.includes('/git/ref/tags/')) {
        return { status: 0, stdout: JSON.stringify({ object: { type: 'tag', sha: 'tag-1' } }) }
      }
      if (path.endsWith('/tag-1')) {
        return { status: 0, stdout: JSON.stringify({ object: { type: 'tag', sha: 'tag-2' } }) }
      }
      return { status: 0, stdout: JSON.stringify({ object: { type: 'commit', sha: 'commit-1' } }) }
    }

    assert.equal(
      resolveReleaseTagCommit({
        tag: 'cli/v1.0.0-beta.35',
        repository: 'astrale-os/cli',
        gh,
      }),
      'commit-1',
    )
    assert.equal(calls.length, 3)
  })

  it('rejects an immutable tag at the wrong commit before inspecting or uploading assets', async () => {
    const directory = await fixture()
    const release = fakeGh()
    const calls = []
    const gh = (args) => {
      calls.push(args)
      if (args[0] === 'api') {
        return {
          status: 0,
          stdout: JSON.stringify({ object: { type: 'commit', sha: 'wrong-commit' } }),
          stderr: '',
        }
      }
      return release.command(args)
    }

    await assert.rejects(
      publishReleaseAssets({
        tag: 'cli/v1.0.0-beta.35',
        directory,
        expectedCommit: 'release-commit',
        repository: 'astrale-os/cli',
        gh,
      }),
      /resolves to wrong-commit, expected release-commit/u,
    )
    assert.deepEqual(
      calls.map((args) => args[0]),
      ['api'],
    )
    assert.equal(release.uploads.length, 0)
  })
})
