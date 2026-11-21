import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CHANNEL_BRANCH,
  publishChannelPointer,
  readChannelPointer,
} from './publish-channel-pointer.mjs'

const repository = 'astrale-os/cli'
const [first, second, unrelated] = ['a', 'b', 'c'].map((digit) => digit.repeat(40))
const manifest = (version) => ({
  version,
  binaryVersion: version,
  channel: 'beta',
  repo: repository,
  assets: {},
})

/** An in-memory GitHub with one channel branch; `second` descends from `first`. */
function github({ branch = true } = {}) {
  const files = new Map()
  const writes = []
  let exists = branch
  const ok = (value) => ({ status: 0, stdout: JSON.stringify(value), stderr: '' })
  const notFound = { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' }
  const gh = (args, input) => {
    const method = args[1] === '--method' ? args[2] : 'GET'
    const path = args[method === 'GET' ? 1 : 3]
    const body = input === undefined ? undefined : JSON.parse(input)
    if (method !== 'GET') writes.push({ method, path, body })
    if (path === `repos/${repository}/git/ref/heads/${CHANNEL_BRANCH}`) {
      return exists ? ok({ object: { sha: 'tip' } }) : notFound
    }
    const content = /contents\/(.+)\?ref=release-channels$/u.exec(path)
    if (method === 'GET' && content) {
      const file = files.get(content[1])
      return file ? ok({ sha: file.sha, content: file.content }) : notFound
    }
    if (method === 'PUT') {
      const name = path.split('/contents/')[1]
      assert.equal(body.branch, CHANNEL_BRANCH)
      assert.equal(body.sha, files.get(name)?.sha)
      files.set(name, { sha: `blob-${writes.length}`, content: body.content })
      return ok({})
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      for (const entry of body.tree) {
        files.set(entry.path, {
          sha: 'blob-0',
          content: Buffer.from(entry.content).toString('base64'),
        })
      }
      return ok({ sha: 'tree' })
    }
    if (method === 'POST' && path.endsWith('/git/commits')) {
      assert.deepEqual(body.parents, [])
      return ok({ sha: 'orphan' })
    }
    if (method === 'POST' && path.endsWith('/git/refs')) {
      exists = true
      return ok({})
    }
    const compare = /compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)$/u.exec(path)
    if (compare) {
      const [, base, head] = compare
      if (base === head) return ok({ status: 'identical' })
      return ok({ status: base === first && head === second ? 'ahead' : 'diverged' })
    }
    throw new Error(`unexpected gh ${args.join(' ')}`)
  }
  return { gh, writes, files }
}

const publish = (gh, version, commit, extra = {}) =>
  publishChannelPointer({
    repository,
    channel: 'beta',
    manifest: manifest(version),
    commit,
    gh,
    ...extra,
  })

test('the first publication creates an orphan branch holding only the channel pointer', () => {
  const state = github({ branch: false })
  publish(state.gh, '1.0.0-beta.156', first)
  assert.deepEqual(
    state.writes.map(({ method, path }) => `${method} ${path.split('/').slice(3).join('/')}`),
    ['POST git/trees', 'POST git/commits', 'POST git/refs'],
  )
  assert.deepEqual(readChannelPointer({ repository, channel: 'beta', gh: state.gh }).pointer, {
    ...manifest('1.0.0-beta.156'),
    commit: first,
  })
})

test('a channel advances to a descendant and a rerun writes nothing', () => {
  const state = github()
  publish(state.gh, '1.0.0-beta.156', first)
  publish(state.gh, '1.0.0-beta.157', second)
  const writes = state.writes.length
  publish(state.gh, '1.0.0-beta.157', second)
  assert.equal(state.writes.length, writes)
  assert.equal(
    readChannelPointer({ repository, channel: 'beta', gh: state.gh }).pointer.version,
    '1.0.0-beta.157',
  )
})

test('an automatic publication never moves a channel back or sideways', () => {
  const state = github()
  publish(state.gh, '1.0.0-beta.157', second)
  for (const commit of [first, unrelated]) {
    assert.throws(() => publish(state.gh, '1.0.0-beta.156', commit), /non-successor/u)
  }
  publish(state.gh, '1.0.0-beta.156', first, { allowBackward: true })
  assert.equal(
    readChannelPointer({ repository, channel: 'beta', gh: state.gh }).pointer.commit,
    first,
  )
})

test('channel names and commits are validated before any request', () => {
  const state = github()
  for (const channel of ['', 'Beta', '../main', 'beta/x']) {
    assert.throws(
      () =>
        publishChannelPointer({
          repository,
          channel,
          manifest: manifest('1.0.0'),
          commit: first,
          gh: state.gh,
        }),
      /invalid release channel/u,
    )
  }
  assert.throws(() => publish(state.gh, '1.0.0', 'main'), /invalid release commit/u)
  assert.equal(state.writes.length, 0)
})
