import { describe, expect, test } from 'bun:test'

import type { Identity } from '../../identity/index'
import type { AstraleConfig } from '../../lib/config'

import { IdpAudienceMismatchError } from '../../lib/idp'
import { IdpSessionNoRefreshTokenError } from '../../lib/idp-session'
import {
  classifyNoRefreshTokenError,
  persistedIdpSourceIdentity,
  resolveKeyIdentityAuthOptions,
} from '../auth'

const config: AstraleConfig = {
  issuer: 'https://unregistered.invalid',
  admin: {
    name: 'admin',
    url: 'https://admin.eu.astrale.ai/api',
    kernelIssuer: 'https://admin.eu.astrale.ai/api',
  },
  telemetry: { enabled: true, analyzerEnabled: false },
  browser: {},
}

describe('resolveKeyIdentityAuthOptions', () => {
  test('uses key identity issuer before global config issuer', () => {
    const identity: Identity = {
      subject: 'system',
      source: 'key',
      mode: 'local',
      issuer: 'https://51-15-255-161.sslip.io',
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    expect(
      resolveKeyIdentityAuthOptions(identity, config, 'https://51-15-255-161.sslip.io', 'scw-e2e'),
    ).toEqual({
      issuer: 'https://51-15-255-161.sslip.io',
      subject: undefined,
      audience: 'https://51-15-255-161.sslip.io',
    })
  })

  test('uses target audience as issuer for imported system bootstrap identities', () => {
    const identity: Identity = {
      subject: 'system',
      source: 'key',
      mode: 'local',
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    expect(
      resolveKeyIdentityAuthOptions(identity, config, 'https://51-15-255-161.sslip.io', 'scw-e2e'),
    ).toEqual({
      issuer: 'https://51-15-255-161.sslip.io',
      subject: undefined,
      audience: 'https://51-15-255-161.sslip.io',
    })
  })

  test('registration issuer and subject still override identity issuer', () => {
    const identity: Identity = {
      subject: 'alice',
      source: 'key',
      mode: 'local',
      issuer: 'https://identity.example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      registrations: {
        prod: {
          iss: 'https://prod.example.com/iss/thumbprint',
          sub: 'node-1',
          registeredAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }

    expect(
      resolveKeyIdentityAuthOptions(identity, config, 'https://prod.example.com', 'prod'),
    ).toEqual({
      issuer: 'https://prod.example.com/iss/thumbprint',
      subject: 'node-1',
      audience: 'https://prod.example.com',
    })
  })

  /** @evidence TEST-CLI-AUTH-USES-DIRECT-URL-REGISTRATION */
  test('uses a registration stored for a direct URL target', () => {
    const url = 'https://kernel.example/invoke'
    const identity: Identity = {
      subject: 'alice',
      source: 'key',
      mode: 'local',
      createdAt: '2026-01-01T00:00:00.000Z',
      registrations: {
        [url]: {
          iss: 'https://kernel.example/identity/alice',
          sub: 'alice-node',
          registeredAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }

    expect(resolveKeyIdentityAuthOptions(identity, config, 'https://kernel.example', url)).toEqual({
      issuer: 'https://kernel.example/identity/alice',
      subject: 'alice-node',
      audience: 'https://kernel.example',
    })
  })
})

describe('classifyNoRefreshTokenError', () => {
  test('preserves expiry when the non-refreshable session already targets the required audience', () => {
    const expired = new IdpSessionNoRefreshTokenError('alice')

    expect(
      classifyNoRefreshTokenError('https://kernel.example', 'https://kernel.example', expired),
    ).toBe(expired)
  })

  test('reports a real audience mismatch when the source audience differs', () => {
    const result = classifyNoRefreshTokenError(
      'https://child.example',
      'https://manager.example',
      new IdpSessionNoRefreshTokenError('alice'),
    )

    expect(result).toBeInstanceOf(IdpAudienceMismatchError)
    expect(result).toMatchObject({
      requested: 'https://child.example',
      actual: 'https://manager.example',
    })
  })
})

describe('persistedIdpSourceIdentity', () => {
  const identity: Identity = {
    subject: 'user-1',
    source: 'idp',
    idp: 'workos',
    mode: 'remote',
    issuer: 'https://issuer.example',
    createdAt: '2026-01-01T00:00:00.000Z',
  }

  test('admits only matching non-empty issuer and subject claims', () => {
    expect(
      persistedIdpSourceIdentity(identity, {
        claims: { iss: 'https://issuer.example', sub: 'user-1' },
      }),
    ).toEqual({ issuer: 'https://issuer.example', subject: 'user-1' })

    for (const claims of [
      undefined,
      {},
      { iss: '', sub: 'user-1' },
      { iss: 'https://other-issuer.example', sub: 'user-1' },
      { iss: 'https://issuer.example', sub: '' },
      { iss: 'https://issuer.example', sub: 'user-2' },
    ]) {
      expect(persistedIdpSourceIdentity(identity, { claims })).toBeUndefined()
    }
  })

  test('never supplies a cache identity for a key-backed identity', () => {
    expect(
      persistedIdpSourceIdentity(
        { ...identity, source: 'key', mode: 'local' },
        { claims: { iss: 'https://issuer.example', sub: 'user-1' } },
      ),
    ).toBeUndefined()
  })
})
