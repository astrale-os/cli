import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseAllDocuments } from 'yaml'

const repository = fileURLToPath(new URL('..', import.meta.url))
const checker = resolve(repository, 'scripts/verify-public-dependency-boundary.mjs')
const peerPath = 'studio/e2e/fixture/peer/package.json'

/** Real repository policy and lock inputs; no dependency installation or linked packages. */
function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'cli-public-dependency-boundary-'))
  try {
    for (const path of [
      'package.json',
      'studio/package.json',
      'studio/e2e/fixture/package.json',
      peerPath,
      '.npmrc',
      'studio/.npmrc',
      '.bun-version',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      'scripts/build.ts',
      // Preserve the actual compiler-API owner that justifies Studio's TypeScript profile.
      'studio/shared/contracts/surface.test.ts',
    ]) {
      const target = resolve(directory, path)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(resolve(repository, path), target)
    }
    execFileSync('git', ['init', '--quiet', directory], { stdio: 'pipe' })
    execFileSync('git', ['add', 'scripts/build.ts', 'studio/shared/contracts/surface.test.ts'], {
      cwd: directory,
      stdio: 'pipe',
    })
    return directory
  } catch (cause) {
    rmSync(directory, { recursive: true, force: true })
    throw cause
  }
}

function verify(directory) {
  return execFileSync(process.execPath, [checker], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  })
}

function withFixture(run) {
  const directory = fixture()
  try {
    run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function changePeer(directory, update) {
  const path = resolve(directory, peerPath)
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  update(manifest)
  writeFileSync(path, JSON.stringify(manifest, null, 2))
}

function refusal(directory, reason) {
  assert.throws(
    () => verify(directory),
    (cause) => {
      assert.match(String(cause.stderr), reason)
      return true
    },
  )
}

describe('CLI public dependency qualification', () => {
  it('admits the real four-manifest registry cohort and qualification lock', () => {
    withFixture((directory) => {
      assert.match(verify(directory), /verified CLI public dependency closure/u)
    })
  })

  it('refuses a peer fixture that retains another SDK publication', () => {
    withFixture((directory) => {
      changePeer(directory, (manifest) => {
        manifest.dependencies['@astrale-os/sdk'] = '0.0.0'
      })
      refusal(directory, /Studio peer fixture must qualify the current exact SDK publication/u)
    })
  })

  it('refuses a peer fixture that retains another Cloudflare adapter publication', () => {
    withFixture((directory) => {
      changePeer(directory, (manifest) => {
        manifest.dependencies['@astrale-os/adapter-cloudflare'] = '0.0.0'
      })
      refusal(directory, /fixtures must qualify the same exact Cloudflare adapter publication/u)
    })
  })

  it('refuses a peer fixture that resolves an SDK through a local archive', () => {
    withFixture((directory) => {
      changePeer(directory, (manifest) => {
        manifest.dependencies['@astrale-os/sdk'] = 'file:./sdk.tgz'
      })
      refusal(
        directory,
        /peer\/package\.json dependencies\.@astrale-os\/sdk must resolve through a registry package version/u,
      )
    })
  })

  it('refuses a peer importer whose lock specifier differs from its declared SDK', () => {
    withFixture((directory) => {
      const path = resolve(directory, 'pnpm-lock.yaml')
      const documents = parseAllDocuments(readFileSync(path, 'utf8'))
      const qualification = documents.find((document) =>
        document.hasIn(['importers', 'studio/e2e/fixture/peer']),
      )
      assert.ok(qualification)
      qualification.setIn(
        ['importers', 'studio/e2e/fixture/peer', 'dependencies', '@astrale-os/sdk', 'specifier'],
        '0.0.0',
      )
      writeFileSync(path, documents.map((document) => document.toString()).join('\n---\n'))
      refusal(
        directory,
        /importer studio\/e2e\/fixture\/peer must retain dependencies\.@astrale-os\/sdk/u,
      )
    })
  })
})
