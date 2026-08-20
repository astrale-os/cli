import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveCliRelease } from './resolve-cli-release.mjs'

describe('resolveCliRelease', () => {
  it('resolves a Release Please beta as one immutable beta release', () => {
    assert.deepEqual(
      resolveCliRelease({ releaseVersion: '1.0.0-beta.0', binaryVersion: '1.0.0-beta.0' }),
      {
        version: '1.0.0-beta.0',
        binary_version: '1.0.0-beta.0',
        immutable_tag: 'cli/v1.0.0-beta.0',
        channel: 'beta',
        prerelease: 'true',
      },
    )
  })

  it('resolves a stable Release Please version to latest/stable semantics', () => {
    assert.deepEqual(resolveCliRelease({ releaseVersion: '1.0.0', binaryVersion: '1.0.0' }), {
      version: '1.0.0',
      binary_version: '1.0.0',
      immutable_tag: 'cli/v1.0.0',
      channel: 'stable',
      prerelease: 'false',
    })
  })

  it('retains alpha and rc recovery support', () => {
    assert.equal(
      resolveCliRelease({ releaseVersion: '1.0.0-alpha.2', binaryVersion: '1.0.0-alpha.2' })
        .channel,
      'alpha',
    )
    assert.equal(
      resolveCliRelease({ releaseVersion: '1.0.0-rc.1', binaryVersion: '1.0.0-rc.1' }).channel,
      'rc',
    )
  })

  it('supports a manually pushed immutable recovery tag', () => {
    const result = resolveCliRelease({
      refType: 'tag',
      refName: 'cli/v1.0.0-beta.3',
      binaryVersion: '1.0.0-beta.3',
    })
    assert.equal(result.version, '1.0.0-beta.3')
    assert.equal(result.immutable_tag, 'cli/v1.0.0-beta.3')
    assert.equal(result.channel, 'beta')
  })

  it('keeps an explicit manual canary path without publishing an immutable version', () => {
    assert.deepEqual(
      resolveCliRelease({ sha: '1234567890abcdef', binaryVersion: '1.0.0-beta.0' }),
      {
        version: 'main-1234567890ab',
        binary_version: '1.0.0-beta.0',
        immutable_tag: '',
        channel: 'canary',
        prerelease: 'true',
      },
    )
  })

  it('rejects unsupported prerelease channels', () => {
    assert.throws(
      () => resolveCliRelease({ releaseVersion: '1.0.0-dev.1', binaryVersion: '1.0.0-dev.1' }),
      /Unsupported release version/,
    )
  })

  it('rejects a release identity that differs from the built package', () => {
    assert.throws(
      () =>
        resolveCliRelease({
          releaseVersion: '1.0.0-beta.1',
          binaryVersion: '1.0.0-beta.0',
        }),
      /does not match package version/,
    )
  })
})
