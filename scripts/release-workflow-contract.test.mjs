import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { parse } from 'yaml'

const read = (path) => readFileSync(path, 'utf8')
const workflow = (path) => parse(read(path))

describe('release workflow contract', () => {
  const config = JSON.parse(read('.release-please-config.json'))
  const publish = workflow('.github/workflows/publish.yml')
  const release = workflow('.github/workflows/release.yml')
  const binary = workflow('.github/workflows/cli-release.yml')

  it('uses Release Please beta versioning and the canonical CLI tag shape', () => {
    assert.equal(config.versioning, 'prerelease')
    assert.equal(config.prerelease, true)
    assert.equal(config['prerelease-type'], 'beta')
    assert.equal(config['tag-separator'], '/')
    assert.equal(config['always-update'], true)
  })

  it('derives npm beta and stable tags from the package version', () => {
    const sharedPublish = publish.jobs.publish.steps.at(-1)
    assert.equal(sharedPublish.uses, 'astrale-os/config/.github/actions/publish/packages@main')
    assert.equal(sharedPublish.with['prerelease-tag'], 'auto')
  })

  it('runs the binary publisher only after Release Please creates a release', () => {
    assert.equal(
      release.jobs.release.outputs.created,
      '${{ steps.release.outputs.releases_created }}',
    )
    assert.equal(release.jobs.release.outputs.version, '${{ steps.version.outputs.version }}')
    assert.equal(release.jobs.binary.needs, 'release')
    assert.equal(release.jobs.binary.if, "needs.release.outputs.created == 'true'")
    assert.equal(release.jobs.binary.uses, './.github/workflows/cli-release.yml')
    assert.equal(release.jobs.binary.with.version, '${{ needs.release.outputs.version }}')
  })

  it('accepts the Release Please version through a reusable binary workflow', () => {
    assert.equal(binary.on.workflow_call.inputs.version.required, true)
    assert.equal(binary.on.workflow_call.inputs.version.type, 'string')
    assert.deepEqual(binary.on.push.tags, ['cli/v*'])
    assert.equal(binary.on.push.branches, undefined)

    const metadata = binary.jobs.publish.steps.find((step) => step.id === 'meta')
    assert.equal(metadata.env.RELEASE_VERSION, '${{ inputs.version }}')
    assert.match(metadata.run, /node scripts\/resolve-cli-release\.mjs/)

    const summary = binary.jobs.publish.steps.at(-1)
    assert.match(summary.run, /ASTRALE_CHANNEL=\$\{\{ steps\.meta\.outputs\.channel \}\} sh/)
  })

  it('builds every supported standalone platform exactly once per release run', () => {
    const platforms = binary.jobs.build.strategy.matrix.include.map(
      ({ target_os: os, target_arch: arch }) => `${os}-${arch}`,
    )
    assert.deepEqual(platforms.sort(), ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'])
  })

  it('documents both the one-time beta entry and stable promotion', () => {
    const guide = read('docs/release.md')
    assert.match(guide, /fix\(ci\): automate CLI beta releases/)
    assert.match(guide, /Release-As: 1\.0\.0-beta\.0/)
    assert.match(guide, /chore\(ci\): promote CLI releases to stable/)
    assert.match(guide, /Release-As: 1\.0\.0/)
    assert.match(guide, /Keep `"tag-separator": "\/"`/)
    assert.match(guide, /npm `latest`/)
    assert.match(guide, /standalone `stable` channel/)
    assert.match(guide, /Approve workflows to run/)
    assert.match(guide, /action_required/)
  })
})
