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
const release = 'cli/v1.0.0-beta.133'
const digest = (value) => createHash('sha256').update(value).digest('hex')
function fixture(
  t,
  {
    corrupt = false,
    qualified = true,
    apiFailure = false,
    existing = false,
    retired = false,
    mutable = false,
  } = {},
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
      ...(retired ? { schemaVersion: 2, cloudflaredVersion: '2026.8.2' } : {}),
      version: '1.0.0-beta.133',
      binaryVersion: '1.0.0-beta.133',
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
  const encode = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`).toString('base64')
  let pointer = existing
    ? { sha: 'blob-1', content: encode({ version: '1.0.0-beta.134', commit: 'b'.repeat(40) }) }
    : undefined
  const json = (value) => ({ status: 0, stdout: JSON.stringify(value), stderr: '' })
  const missing = () => ({ status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' })
  const gh = (args, input) => {
    if (args[0] === 'api') {
      const path = args[1]
      if (path === '--method') {
        writes.push(args)
        const body = JSON.parse(input)
        assert.equal(args[2], 'PUT')
        assert.ok(args[3].endsWith('/contents/latest/manifest.json'))
        assert.equal(body.branch, 'release-channels')
        assert.equal(body.sha, pointer?.sha)
        pointer = { sha: `blob-${writes.length + 1}`, content: body.content }
        return json({})
      }
      if (path.endsWith(`/releases/tags/${release}`))
        return json({
          tag_name: release,
          draft: false,
          prerelease: true,
          immutable: !mutable,
          assets,
        })
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
                  name: 'Qualify the published version binary',
                  conclusion: qualified ? 'success' : 'skipped',
                },
              ],
            },
          ],
        })
      if (path.endsWith('/git/ref/heads/release-channels')) return json({ object: { sha: 'tip' } })
      if (path.endsWith('/contents/latest/manifest.json?ref=release-channels')) {
        if (apiFailure) return { status: 1, stdout: '', stderr: 'HTTP 403' }
        return pointer ? json(pointer) : missing()
      }
    }
    if (args[0] === 'release') {
      if (args[1] === 'download') {
        const target = args[args.indexOf('--dir') + 1]
        for (const name of readdirSync(directory))
          copyFileSync(join(directory, name), join(target, name))
        return json({})
      }
    }
    throw new Error(`Unexpected gh operation: ${args.join(' ')}`)
  }
  const latest = () =>
    pointer && JSON.parse(Buffer.from(pointer.content, 'base64').toString('utf8'))
  return { gh, writes, latest }
}

test('preview qualifies reusable workflow jobs and exact downloads without writes', async (t) => {
  const state = fixture(t)
  const report = await promote(release, { gh: state.gh })
  assert.equal(report.mode, 'dry-run')
  assert.equal(report.commit, commit)
  assert.equal(state.writes.length, 0)
})

test('promotion only points latest at the immutable release, and reruns without writes', async (t) => {
  const state = fixture(t)
  await promote(release, { gh: state.gh, apply: true })
  assert.equal(state.writes.length, 1)
  assert.deepEqual(
    { ...state.latest(), assets: undefined },
    {
      version: '1.0.0-beta.133',
      binaryVersion: '1.0.0-beta.133',
      channel: 'latest',
      repo: 'astrale-os/cli',
      assets: undefined,
      commit,
    },
  )
  await promote(release, { gh: state.gh, apply: true })
  assert.equal(state.writes.length, 1)
})

for (const [name, options, error] of [
  ['retired two-binary release', { retired: true }, /schemaVersion is invalid/],
  ['corrupt archive', { corrupt: true }, /differs from immutable/],
  ['skipped qualification', { qualified: false }, /No successful/],
  ['mutable release', { mutable: true }, /must be immutable/],
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
  assert.equal(report.previous, '1.0.0-beta.134')
  assert.equal(state.latest().version, '1.0.0-beta.133')
  assert.equal(state.latest().commit, commit)
})
