import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

/**
 * Channels (`beta`, `latest`, ...) are movable pointers, so they cannot be GitHub releases: an
 * immutable release is sealed by any edit. Each channel is instead one manifest file on this branch,
 * naming a published `cli/v<version>` release; installers download bytes only from that release.
 */
export const CHANNEL_BRANCH = 'release-channels'

const CHANNEL = /^[a-z][a-z0-9-]*$/u
const COMMIT = /^[0-9a-f]{40}$/u

function runGh(args, input) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input })
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

const missing = (result) => result.status !== 0 && result.stderr.includes('(HTTP 404)')

function call(gh, args, description, input) {
  const result = gh(args, input)
  if (result.status !== 0) {
    throw new Error(`${description}: ${result.stderr.trim() || 'gh failed'}`)
  }
  return result.stdout.trim() === '' ? {} : JSON.parse(result.stdout)
}

export function channelPointerPath(channel) {
  if (!CHANNEL.test(channel)) throw new Error(`invalid release channel: ${channel}`)
  return `${channel}/manifest.json`
}

/** The pointer a channel currently holds, or undefined when the channel was never published. */
export function readChannelPointer({ repository, channel, gh = runGh }) {
  const path = channelPointerPath(channel)
  const result = gh(['api', `repos/${repository}/contents/${path}?ref=${CHANNEL_BRANCH}`])
  if (missing(result)) return undefined
  if (result.status !== 0) {
    throw new Error(`could not read channel ${channel}: ${result.stderr.trim() || 'gh failed'}`)
  }
  const file = JSON.parse(result.stdout)
  return {
    sha: file.sha,
    pointer: JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')),
  }
}

/**
 * Point `channel` at the release `manifest` describes, built from `commit`. A channel only moves to
 * a descendant of its current commit unless `allowBackward` (an explicit promotion or rollback).
 */
export function publishChannelPointer({
  repository,
  channel,
  manifest,
  commit,
  allowBackward = false,
  gh = runGh,
}) {
  if (!repository) throw new TypeError('repository is required')
  if (!COMMIT.test(commit ?? '')) throw new TypeError(`invalid release commit: ${commit}`)
  const path = channelPointerPath(channel)
  const pointer = { ...manifest, channel, commit }
  const content = `${JSON.stringify(pointer, null, 2)}\n`
  const message = `chore: point ${channel} at ${manifest.version}`
  const api = `repos/${repository}`

  const branch = gh(['api', `${api}/git/ref/heads/${CHANNEL_BRANCH}`])
  if (missing(branch)) {
    // First publication: an orphan branch holding only channel pointers.
    const tree = call(
      gh,
      ['api', '--method', 'POST', `${api}/git/trees`, '--input', '-'],
      'could not create the channel tree',
      JSON.stringify({ tree: [{ path, mode: '100644', type: 'blob', content }] }),
    )
    const created = call(
      gh,
      ['api', '--method', 'POST', `${api}/git/commits`, '--input', '-'],
      'could not create the channel commit',
      JSON.stringify({ message, tree: tree.sha, parents: [] }),
    )
    call(
      gh,
      ['api', '--method', 'POST', `${api}/git/refs`, '--input', '-'],
      `could not create ${CHANNEL_BRANCH}`,
      JSON.stringify({ ref: `refs/heads/${CHANNEL_BRANCH}`, sha: created.sha }),
    )
    return verify()
  }
  if (branch.status !== 0) {
    throw new Error(`could not inspect ${CHANNEL_BRANCH}: ${branch.stderr.trim() || 'gh failed'}`)
  }

  const current = readChannelPointer({ repository, channel, gh })
  if (current) {
    const previous = current.pointer
    if (previous.version === pointer.version && previous.commit === commit) return pointer
    if (!allowBackward) {
      if (!COMMIT.test(previous.commit ?? '')) {
        throw new Error(`channel ${channel} records no commit; refusing an automatic move`)
      }
      const relation = call(
        gh,
        ['api', `${api}/compare/${previous.commit}...${commit}`],
        `could not compare ${channel} with ${commit}`,
      ).status
      if (relation !== 'ahead' && relation !== 'identical') {
        throw new Error(
          `refusing to move ${channel} from ${previous.commit} to non-successor ${commit} (${relation})`,
        )
      }
    }
  }
  call(
    gh,
    ['api', '--method', 'PUT', `${api}/contents/${path}`, '--input', '-'],
    `could not publish channel ${channel}`,
    JSON.stringify({
      message,
      branch: CHANNEL_BRANCH,
      content: Buffer.from(content).toString('base64'),
      ...(current ? { sha: current.sha } : {}),
    }),
  )
  return verify()

  function verify() {
    const retained = readChannelPointer({ repository, channel, gh })?.pointer
    if (JSON.stringify(retained) !== JSON.stringify(pointer)) {
      throw new Error(`channel ${channel} did not retain the published pointer`)
    }
    return pointer
  }
}

async function main(argv) {
  const [channel, manifestPath] = argv
  const repository = process.env.GITHUB_REPOSITORY
  const commit = process.env.EXPECTED_COMMIT
  if (!channel || !manifestPath || argv.length !== 2 || !repository || !commit) {
    throw new TypeError(
      'usage: GITHUB_REPOSITORY=<owner/repo> EXPECTED_COMMIT=<sha> node scripts/publish-channel-pointer.mjs <channel> <manifest.json>',
    )
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.channel !== channel) {
    throw new Error(`manifest channel ${manifest.channel} does not match ${channel}`)
  }
  const pointer = publishChannelPointer({ repository, channel, manifest, commit })
  console.log(`${channel} -> ${pointer.version} (${commit})`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((cause) => {
    console.error(cause instanceof Error ? cause.message : String(cause))
    process.exitCode = 1
  })
}
