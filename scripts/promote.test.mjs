import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'

import { promote } from './promote.mjs'

const commit = 'a'.repeat(40)
const release = 'cli/v1.0.0-beta.85'
const digest = (value) => createHash('sha256').update(value).digest('hex')
function fixture(
  t,
  { corrupt = false, qualified = true, apiFailure = false, existing = false } = {},
) {
  t.mock.method(console, 'log', () => {})
  const directory = mkdtempSync(join(tmpdir(), 'cli-promotion-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const entries = {}
  for (const platform of ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']) {
    const name = `astrale-${platform}.tar.gz`
    const bytes = Buffer.from(`immutable archive ${platform}`)
    writeFileSync(join(directory, name), bytes)
    entries[platform] = { name, sha256: digest(bytes) }
  }
  writeFileSync(
    join(directory, 'sha256sums.txt'),
    Object.values(entries)
      .map(({ name, sha256 }) => `${sha256}  ${name}\n`)
      .join(''),
  )
  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 2,
      version: '1.0.0-beta.85',
      binaryVersion: '1.0.0-beta.85',
      cloudflaredVersion: '2026.8.2',
      channel: 'beta',
      repo: 'astrale-os/cli',
      assets: entries,
    }),
  )
  const assets = readdirSync(directory).map((name) => ({
    name,
    size: statSync(join(directory, name)).size,
    digest: `sha256:${digest(readFileSync(join(directory, name)))}`,
  }))
  if (corrupt) writeFileSync(join(directory, 'astrale-linux-x64.tar.gz'), 'tampered')
  const writes = []
  const uploaded = new Map()
  let latest = existing ? { body: 'Promoted cli/v1.0.0-beta.99', prerelease: true } : undefined
  let latestCommit = existing ? 'b'.repeat(40) : undefined
  const json = (value) => ({ status: 0, stdout: JSON.stringify(value), stderr: '' })
  const missing = () => ({ status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' })
  const gh = (args) => {
    if (args[0] === 'api') {
      const path = args[1]
      if (path === '--method') {
        writes.push(args)
        latestCommit = args.find((arg) => arg.startsWith('sha=')).slice(4)
        return json({})
      }
      if (path.endsWith(`/releases/tags/${release}`))
        return json({ tag_name: release, draft: false, prerelease: true, assets })
      if (path.endsWith(`/git/ref/tags/${release}`))
        return json({ object: { type: 'commit', sha: commit } })
      if (path.includes('/actions/runs?'))
        return json({
          workflow_runs: [
            {
              id: 1,
              path: '.github/workflows/release.yml',
              head_sha: commit,
              conclusion: 'success',
              html_url: 'https://github.com/astrale-os/cli/actions/runs/1',
            },
          ],
        })
      if (path.includes('/actions/runs/1/jobs?'))
        return json({
          jobs: [
            {
              conclusion: 'success',
              steps: [
                {
                  name: 'Qualify the published channel binary',
                  conclusion: qualified ? 'success' : 'skipped',
                },
              ],
            },
          ],
        })
      if (path.endsWith('/releases/tags/latest')) {
        if (apiFailure) return { status: 1, stdout: '', stderr: 'HTTP 403' }
        return latest ? json(latest) : missing()
      }
      if (path.endsWith('/git/ref/tags/latest'))
        return latestCommit ? json({ object: { type: 'commit', sha: latestCommit } }) : missing()
    }
    if (args[0] === 'release') {
      if (args[1] === 'download') {
        const target = args[args.indexOf('--dir') + 1]
        for (const name of readdirSync(directory))
          copyFileSync(join(directory, name), join(target, name))
        return json({})
      }
      if (['create', 'edit'].includes(args[1])) {
        writes.push(args)
        latest = { body: args[args.indexOf('--notes') + 1], prerelease: true }
        return json({})
      }
      if (args[1] === 'view')
        return json({ assets: [...uploaded.values()].map(({ bytes: _bytes, ...asset }) => asset) })
      if (args[1] === 'upload') {
        writes.push(args)
        const path = args[3]
        const name = path.split('/').at(-1)
        const bytes = readFileSync(path)
        uploaded.set(name, { name, size: bytes.length, digest: `sha256:${digest(bytes)}`, bytes })
        return json({})
      }
    }
    throw new Error(`Unexpected gh operation: ${args.join(' ')}`)
  }
  return { gh, writes, uploaded, assets }
}

test('preview qualifies reusable workflow jobs and exact downloads without writes', async (t) => {
  const state = fixture(t)
  const report = await promote(release, { gh: state.gh })
  assert.equal(report.mode, 'dry-run')
  assert.equal(report.commit, commit)
  assert.equal(state.writes.length, 0)
})

test('promotion copies archives unchanged, changes only manifest channel, and reruns without writes', async (t) => {
  const state = fixture(t)
  await promote(release, { gh: state.gh, apply: true })
  assert.equal(state.uploaded.size, 6)
  for (const source of state.assets.filter(({ name }) => name !== 'manifest.json')) {
    assert.equal(state.uploaded.get(source.name).digest, source.digest)
  }
  assert.equal(JSON.parse(state.uploaded.get('manifest.json').bytes).channel, 'latest')
  const writes = state.writes.length
  await promote(release, { gh: state.gh, apply: true })
  assert.equal(state.writes.length, writes)
  assert.ok(state.writes.every((args) => !args.includes('beta')))
})

for (const [name, options, error] of [
  ['corrupt archive', { corrupt: true }, /differs from immutable/],
  ['skipped qualification', { qualified: false }, /No successful/],
  ['GitHub API failure', { apiFailure: true }, /403/],
]) {
  test(`rejects ${name} before any mutation`, async (t) => {
    const state = fixture(t, options)
    await assert.rejects(promote(release, { gh: state.gh, apply: true }), error)
    assert.equal(state.writes.length, 0)
  })
}

test('rejects moving refs and malformed version inputs', async () => {
  for (const tag of ['main', 'beta', 'latest', 'cli/v1.0.0-beta.01', 'cli/v1.0.0; echo nope']) {
    await assert.rejects(promote(tag), /exact CLI release tag/)
  }
})

test('workflow separates unprivileged preview from protected, serialized publication', () => {
  const workflow = parse(readFileSync('.github/workflows/promote.yml', 'utf8'))
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch'])
  assert.equal(workflow.on.workflow_dispatch.inputs.apply.default, false)
  assert.equal(workflow.permissions.contents, 'read')
  assert.equal(workflow.jobs.preview.if, "github.ref == 'refs/heads/main'")
  assert.equal(workflow.jobs.preview.environment, undefined)
  assert.equal(workflow.jobs.promote.needs, 'preview')
  assert.equal(workflow.jobs.promote.if, 'inputs.apply')
  assert.equal(workflow.jobs.promote.environment, 'cli-release')
  assert.equal(workflow.jobs.promote.concurrency.group, 'cli-release-channel-publication')
})

test('explicit rollback can move latest back to a previously qualified release', async (t) => {
  const state = fixture(t, { existing: true })
  const report = await promote(release, { gh: state.gh, apply: true })
  assert.equal(report.previous, 'Promoted cli/v1.0.0-beta.99')
  assert.ok(state.writes.some((args) => args.includes('PATCH') && args.includes(`sha=${commit}`)))
  assert.equal(JSON.parse(state.uploaded.get('manifest.json').bytes).version, '1.0.0-beta.85')
})
