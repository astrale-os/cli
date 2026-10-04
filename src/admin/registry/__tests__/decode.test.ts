import { describe, expect, test } from 'bun:test'

import { AstraleError } from '../../../errors'
import { exactPublicationReference, publishRequest, registryOrigin } from '../decode'
import { RegistryError } from '../model'
import { compareVersions } from '../order'

const DIGEST = `sha256:${'e'.repeat(64)}` as const

function request(publication: Record<string, unknown>, top: Record<string, unknown> = {}) {
  return {
    format: 'astrale.registry-publish-request',
    version: 1,
    publication: {
      origin: 'issues.astrale.ai',
      version: '1.5.0',
      url: 'https://issues-0123.svc.eu.beta.astrale.ai',
      releaseDigest: DIGEST,
      dirty: false,
      ...publication,
    },
    ...top,
  }
}

function thrown(run: () => unknown): AstraleError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(AstraleError)
    return error as AstraleError
  }
  throw new Error('expected a refusal')
}

describe('publish request (CT29 PublishRequestV1)', () => {
  test('admits the documented request', () => {
    expect(publishRequest(request({ commit: 'a'.repeat(40) }))).toEqual({
      format: 'astrale.registry-publish-request',
      version: 1,
      publication: {
        origin: 'issues.astrale.ai',
        version: '1.5.0',
        url: 'https://issues-0123.svc.eu.beta.astrale.ai',
        releaseDigest: DIGEST,
        commit: 'a'.repeat(40),
        dirty: false,
      },
    })
  })

  test('refuses another format, unknown fields and missing fields as input errors', () => {
    expect(thrown(() => publishRequest(request({}, { format: 'other' }))).code).toBe(
      'INVALID_INPUT',
    )
    expect(thrown(() => publishRequest(request({}, { extra: 1 }))).code).toBe('INVALID_INPUT')
    expect(thrown(() => publishRequest(request({ bundle: 'x' }))).code).toBe('INVALID_INPUT')
    const { dirty: _dirty, ...withoutDirty } = request({}).publication
    expect(thrown(() => publishRequest({ ...request({}), publication: withoutDirty })).code).toBe(
      'INVALID_INPUT',
    )
    expect(thrown(() => publishRequest(request({ releaseDigest: 'sha256:abc' }))).code).toBe(
      'INVALID_INPUT',
    )
    expect(thrown(() => publishRequest(request({ origin: 'https://x.example' }))).code).toBe(
      'INVALID_INPUT',
    )
  })

  test('refuses a version the SDK versioning module refuses', () => {
    for (const version of ['v1.5.0', '1.5.0+build.1', '1.5', '01.5.0']) {
      const error = thrown(() => publishRequest(request({ version })))
      expect(error).toBeInstanceOf(RegistryError)
      expect(error.code).toBe('PUBLICATION_VERSION_INVALID')
    }
  })
})

describe('exact references', () => {
  test('read <origin>@<version> with the install parser', () => {
    expect(exactPublicationReference('issues.astrale.ai@2.0.0-rc.1')).toEqual({
      origin: 'issues.astrale.ai',
      version: '2.0.0-rc.1',
    })
  })

  test('a line, a range, a URL or a bare origin names no Publication', () => {
    for (const input of [
      'issues.astrale.ai@1.5',
      'issues.astrale.ai@^1.5.0',
      'issues.astrale.ai',
      'https://issues.astrale.ai',
      'issues.astrale.ai@v1.5.0',
    ]) {
      const error = thrown(() => exactPublicationReference(input))
      expect(error.code).toBe('PUBLICATION_VERSION_INVALID')
    }
  })

  test('an origin is a lower-case DNS name', () => {
    expect(registryOrigin('issues.astrale.ai')).toBe('issues.astrale.ai')
    for (const input of ['Issues.astrale.ai', 'issues', 'issues.astrale.ai@1.5.0', 'https://a.b'])
      expect(thrown(() => registryOrigin(input)).code).toBe('INVALID_ARGUMENT')
  })
})

describe('SemVer precedence of the index', () => {
  test('orders as SemVer 2.0.0 §11', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.2.0',
      '1.10.0',
      '2.0.0-0',
      '2.0.0',
    ]
    const shuffled = [...ordered].reverse()
    expect(shuffled.sort(compareVersions)).toEqual(ordered)
    expect(compareVersions('1.5.0', '1.5.0')).toBe(0)
  })
})
