import { describe, expect, test } from 'bun:test'

import type { AstraleConfig } from '../../lib/config'
import type { Identity } from '../../lib/identity'

import { resolveKeyIdentityAuthOptions } from '../auth'

const config: AstraleConfig = {
  issuer: 'https://identity.astrale.ai',
  admin: {
    name: 'admin',
    url: 'https://admin.eu.astrale.ai/api',
    issuer: 'https://admin.eu.astrale.ai/api',
  },
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
})
