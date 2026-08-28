import type { SessionAuth } from '@astrale-os/sdk/client/session'

import { issuer, type IssuerId } from '@astrale-os/sdk/auth'
import { Path } from '@astrale-os/sdk/graph/path'
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AstraleConfig } from '../../lib/config'

import { persistKeypair, signAs } from '../../keys/index'
import { bindCredentialIdentity } from '../auth'
import { createCliCredential, createConnectionCredential } from '../credential'

const SOURCE = issuer.accept('https://kernel.example')
const TARGET_CALL = Object.freeze({
  target: Path.parse('/:example.dev:function.call').raw,
  input: { value: 1 },
}) satisfies Parameters<SessionAuth['resolve']>[0]
const config: AstraleConfig = {
  issuer: 'https://cli.example',
  admin: { name: 'admin', url: SOURCE, kernelIssuer: SOURCE },
  telemetry: { enabled: false, analyzerEnabled: false },
  browser: {},
}

describe('connection credential', () => {
  test('pins the bookmark identity while leaving explicit credentials unnamed', async () => {
    const target = {
      url: `${SOURCE}/invoke`,
      kernelIssuer: SOURCE,
      defaultIdentity: 'bookmark-owner',
    }

    await expect(bindCredentialIdentity({}, target)).resolves.toMatchObject({
      as: 'bookmark-owner',
    })
    await expect(bindCredentialIdentity({ as: 'explicit-owner' }, target)).resolves.toEqual({
      as: 'explicit-owner',
    })
    await expect(bindCredentialIdentity({ creds: 'opaque' }, target)).resolves.toEqual({
      creds: 'opaque',
    })
  })

  /** @evidence TEST-CLI-CONNECTION-RESOLVES-SOURCE-AUTH-BEFORE-ROUTING */
  test('resolves source authority without destination knowledge', async () => {
    const audiences: IssuerId[] = []
    const calls: unknown[] = []
    const auth = createConnectionCredential(SOURCE, {
      async resolve(audience) {
        audiences.push(audience)
        return `source:${audience}`
      },
    })
    const signal = new AbortController().signal

    calls.push(TARGET_CALL)
    await expect(auth.resolve(TARGET_CALL, signal)).resolves.toEqual({
      credential: `source:${SOURCE}`,
    })

    expect(auth.ttlSeconds).toBe(60)
    expect(audiences).toEqual([SOURCE])
    expect(calls).toEqual([TARGET_CALL])
  })

  /** @evidence TEST-CLI-CONNECTION-BOUNDS-REMOTE-CARRIER-TO-SOURCE-LIFETIME */
  test('bounds destination delegation to the current source credential lifetime', async () => {
    const expiresAt = Math.ceil(Date.now() / 1_000) + 120
    const auth = createConnectionCredential(SOURCE, {
      async resolve() {
        return token(expiresAt)
      },
    })

    const resolved = await auth.resolve(TARGET_CALL, new AbortController().signal)
    expect(resolved.credential).toBe(token(expiresAt))
    expect(resolved.delegate?.ttlSeconds).toBeGreaterThan(0)
    expect(resolved.delegate?.ttlSeconds).toBeLessThan(120)
  })

  /** @evidence TEST-CLI-CONNECTION-CARRIER-COVERS-COMMAND-TIMEOUT */
  test('covers a long command deadline with one destination carrier', async () => {
    const expiresAt = Math.ceil(Date.now() / 1_000) + 300
    const auth = createConnectionCredential(SOURCE, { resolve: async () => token(expiresAt) }, 185)

    await expect(auth.resolve(TARGET_CALL, new AbortController().signal)).resolves.toMatchObject({
      credential: token(expiresAt),
      delegate: { ttlSeconds: 185 },
    })
    expect(auth.ttlSeconds).toBe(185)
  })

  test('real local-key credentials cover the supported long-operation carrier', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'astrale-carrier-key-'))
    try {
      await persistKeypair('alice', { keysDir: directory })
      const source = await signAs('alice', directory, {
        issuer: SOURCE,
        audience: SOURCE,
      })
      const auth = createConnectionCredential(SOURCE, { resolve: async () => source }, 185)

      await expect(auth.resolve(TARGET_CALL, new AbortController().signal)).resolves.toMatchObject({
        credential: source,
        delegate: { ttlSeconds: 185 },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('real five-minute local-key credentials reject a 600-second carrier before dispatch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'astrale-carrier-ceiling-key-'))
    try {
      await persistKeypair('alice', { keysDir: directory })
      const source = await signAs('alice', directory, {
        issuer: SOURCE,
        audience: SOURCE,
      })
      const auth = createConnectionCredential(SOURCE, { resolve: async () => source }, 605)

      await expect(auth.resolve(TARGET_CALL, new AbortController().signal)).rejects.toMatchObject({
        code: 'CREDENTIAL_LIFETIME_INSUFFICIENT',
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('derives every destination carrier lifetime from the selected CLI timeout', () => {
    for (const target of [
      { url: `${SOURCE}/invoke`, kernelIssuer: SOURCE },
      {
        url: `${SOURCE}/invoke`,
        kernelIssuer: SOURCE,
        domainIssuer: issuer.accept('https://admin.example'),
      },
    ]) {
      const auth = createCliCredential(target, {}, config, globalThis.fetch, 180_000)
      expect(auth?.ttlSeconds).toBe(185)
    }
  })

  test('rejects a long command before dispatch when its source bearer is too short', async () => {
    const expiresAt = Math.ceil(Date.now() / 1_000) + 120
    const auth = createConnectionCredential(SOURCE, { resolve: async () => token(expiresAt) }, 185)

    await expect(auth.resolve(TARGET_CALL, new AbortController().signal)).rejects.toMatchObject({
      code: 'CREDENTIAL_LIFETIME_INSUFFICIENT',
    })
  })

  test('rejects an inspectable short or expired bearer before a default command dispatch', async () => {
    for (const expiresAt of [
      Math.ceil(Date.now() / 1_000) + 30,
      Math.ceil(Date.now() / 1_000) - 30,
    ]) {
      const auth = createConnectionCredential(SOURCE, {
        resolve: async () => token(expiresAt),
      })
      await expect(auth.resolve(TARGET_CALL, new AbortController().signal)).rejects.toMatchObject({
        code: 'CREDENTIAL_LIFETIME_INSUFFICIENT',
      })
    }
  })

  test('rejects a too-short explicit Domain bearer before exchange or destination I/O', async () => {
    let fetches = 0
    const expiresAt = Math.ceil(Date.now() / 1_000) + 120
    const auth = createCliCredential(
      {
        url: `${SOURCE}/invoke`,
        kernelIssuer: SOURCE,
        domainIssuer: issuer.accept('https://admin.example'),
      },
      { creds: token(expiresAt) },
      config,
      async () => {
        fetches += 1
        throw new Error('network must remain untouched')
      },
      180_000,
    )
    if (auth === undefined) throw new Error('expected authenticated credential')

    await expect(auth.resolve(TARGET_CALL, new AbortController().signal)).rejects.toMatchObject({
      code: 'CREDENTIAL_LIFETIME_INSUFFICIENT',
    })
    expect(fetches).toBe(0)
  })

  /** @evidence TEST-CLI-CONNECTION-USES-RAW-SOURCE-CREDENTIAL */
  test('binds explicit CLI credentials to source-Kernel auth only', async () => {
    const auth = createCliCredential(
      { url: `${SOURCE}/invoke`, kernelIssuer: SOURCE, slug: 'source' },
      { creds: 'raw-source-token' },
      config,
    )
    if (auth === undefined) throw new Error('expected authenticated credential')

    await expect(auth.resolve(TARGET_CALL, new AbortController().signal)).resolves.toEqual({
      credential: 'raw-source-token',
    })
  })

  /** @evidence TEST-CLI-CONNECTION-OMITS-EXPLICIT-ANONYMOUS-CREDENTIAL */
  test('omits the auth capability for an explicit anonymous session', () => {
    const auth = createCliCredential(
      { url: `${SOURCE}/invoke`, kernelIssuer: SOURCE, defaultIdentity: 'ambient-default' },
      { anonymous: true },
      config,
    )

    expect(auth).toBeUndefined()
  })

  test('rejects --as combined with --creds', () => {
    expect(() =>
      createCliCredential(
        { url: `${SOURCE}/invoke`, kernelIssuer: SOURCE },
        { as: 'alice', creds: 'token' },
        config,
      ),
    ).toThrow('--as cannot be combined with --creds')
  })

  /** @evidence TEST-CLI-CONNECTION-PROPAGATES-AUTH-CANCELLATION */
  test('passes the live Session operation signal to source credential resolution', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const auth = createConnectionCredential(SOURCE, {
      async resolve(_audience, signal) {
        expect(signal).toBe(controller.signal)
        throw signal.reason
      },
    })
    controller.abort(reason)

    await expect(auth.resolve(TARGET_CALL, controller.signal)).rejects.toBe(reason)
  })
})

function token(exp: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode({
    iss: SOURCE,
    sub: 'principal',
    aud: SOURCE,
    exp,
  })}.signature`
}
