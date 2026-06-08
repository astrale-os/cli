import { describe, expect, test } from 'bun:test'
import { SignJWT } from 'jose'
import { webcrypto } from 'node:crypto'

import {
  containsSelfRef,
  expandSelfReferences,
  resolveSelfNodeId,
  selfRefusalError,
  type SelfResolverContext,
  type SelfResolution,
} from '../self'

// ── Regex behavior ───────────────────────────────────────────

describe('containsSelfRef / expandSelfReferences', () => {
  const ID = 'node-abc-123'

  // Cases that MUST match — documented positions only.
  test.each([
    ['@self', `@${ID}`],
    ['@self::deployFunction', `@${ID}::deployFunction`],
    ['@self/functions', `@${ID}/functions`], // path navigation
    ['@self/functions/foo', `@${ID}/functions/foo`],
    ['node=@self', `node=@${ID}`],
    ['target=@self::method', `target=@${ID}::method`],
    ['target=@self/sub', `target=@${ID}/sub`],
    ['x=@self::m  y=@self', `x=@${ID}::m  y=@${ID}`], // double match
  ])('expands %p → %p', (input, expected) => {
    expect(containsSelfRef(input)).toBe(true)
    expect(expandSelfReferences(input, ID)).toBe(expected)
  })

  // selfId carrying `String.replace` substitution metacharacters must not
  // be re-interpreted (function-form replacement guards this).
  test.each([
    ['@self', 'x$&y', '@x$&y'],
    ['@self', 'x$$y', '@x$$y'],
    ['@self', 'x$1y', '@x$1y'],
    ['@self', 'x$`y', '@x$`y'],
    ['@self::m', 'x$&y', '@x$&y::m'],
  ])('selfId with `$` metachars is treated literally: %p × %p → %p', (input, id, expected) => {
    expect(expandSelfReferences(input, id)).toBe(expected)
  })

  // Cases that MUST NOT match — substrings, JSON-like, comma-lists.
  test.each([
    'prefix@self',
    '@selfsuffix',
    '@self.example',
    '@self,@other',
    'node=before@self',
    '{"ref":"@self"}', // inside quoted JSON — lookbehind requires `=` or `^`
    'no-self-here',
  ])('does NOT expand %p', (input) => {
    expect(containsSelfRef(input)).toBe(false)
    expect(expandSelfReferences(input, ID)).toBe(input)
  })

  test('containsSelfRef is stateless across calls (regex.lastIndex reset)', () => {
    // Both calls should return true even though the underlying global regex
    // tracks lastIndex internally. The implementation must reset it.
    expect(containsSelfRef('@self')).toBe(true)
    expect(containsSelfRef('@self')).toBe(true)
    expect(containsSelfRef('@self')).toBe(true)
  })
})

// ── Resolver — refusal paths ─────────────────────────────────

describe('resolveSelfNodeId refusals', () => {
  test('bootstrap manager identity → manager', () => {
    const ctx: SelfResolverContext = {
      identity: { name: 'manager', subject: 'manager', createdAt: 'x' },
      instanceSlug: 'manager',
      instanceSigned: false,
    }
    const r = resolveSelfNodeId(ctx)
    expect(r).toEqual({ reason: 'manager' })
  })

  test('identity without registration on slug → no-registration', () => {
    const ctx: SelfResolverContext = {
      identity: { name: 'alice', subject: 'alice', createdAt: 'x' },
      instanceSlug: 'kernel-aidev',
      instanceSigned: false,
    }
    const r = resolveSelfNodeId(ctx)
    expect(r).toEqual({
      reason: 'no-registration',
      identityName: 'alice',
      instanceSlug: 'kernel-aidev',
    })
  })

  test('instance-signed path → instance-signed', () => {
    const ctx: SelfResolverContext = {
      identity: { name: 'manager', subject: 'manager', createdAt: 'x' },
      instanceSlug: 'child-with-keypair',
      instanceSigned: true,
    }
    const r = resolveSelfNodeId(ctx)
    expect(r).toEqual({ reason: 'instance-signed', instanceSlug: 'child-with-keypair' })
  })

  test('no slug (--url without -i) → url-no-slug', () => {
    const ctx: SelfResolverContext = {
      identity: { name: 'alice', subject: 'alice', createdAt: 'x' },
      instanceSlug: undefined,
      instanceSigned: false,
    }
    const r = resolveSelfNodeId(ctx)
    expect(r).toEqual({ reason: 'url-no-slug' })
  })

  test('--creds with malformed JWT → creds-no-sub', () => {
    const ctx: SelfResolverContext = {
      credsJwt: 'not-a-jwt',
      instanceSigned: false,
    }
    const r = resolveSelfNodeId(ctx)
    expect(r).toEqual({ reason: 'creds-no-sub' })
  })

  test('--creds with valid JWT but empty sub → creds-no-sub', async () => {
    const key = await generateEs256()
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer('test')
      .setAudience('test')
      .sign(key)
    const ctx: SelfResolverContext = { credsJwt: jwt, instanceSigned: false }
    const r = resolveSelfNodeId(ctx)
    expect(r).toEqual({ reason: 'creds-no-sub' })
  })

  test('--creds with whitespace-only sub → creds-no-sub', async () => {
    const key = await generateEs256()
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject('   ')
      .setIssuer('test')
      .setAudience('test')
      .sign(key)
    const ctx: SelfResolverContext = { credsJwt: jwt, instanceSigned: false }
    const r = resolveSelfNodeId(ctx)
    expect(r).toEqual({ reason: 'creds-no-sub' })
  })
})

// ── Resolver — happy paths ───────────────────────────────────

describe('resolveSelfNodeId happy paths', () => {
  test('--as identity with registration → registration sub', () => {
    const ctx: SelfResolverContext = {
      identity: {
        name: 'alice',
        subject: 'alice',
        createdAt: 'x',
        registrations: {
          'kernel-aidev': { iss: 'https://aidev/', sub: 'node-id-aidev', registeredAt: 'x' },
        },
      },
      instanceSlug: 'kernel-aidev',
      instanceSigned: false,
    }
    const r = resolveSelfNodeId(ctx)
    expect(r).toEqual({ id: 'node-id-aidev' })
  })

  test('default identity with registration → registration sub', () => {
    const ctx: SelfResolverContext = {
      identity: {
        name: 'computer',
        subject: 'kernel-node-id',
        createdAt: 'x',
        registrations: {
          kernel: { iss: 'https://k/', sub: 'kernel-node-id', registeredAt: 'x' },
        },
      },
      instanceSlug: 'kernel',
      instanceSigned: false,
    }
    const r: SelfResolution = resolveSelfNodeId(ctx)
    expect(r).toEqual({ id: 'kernel-node-id' })
  })

  test('--creds with valid sub → sub wins over identity', async () => {
    const key = await generateEs256()
    const jwt = await new SignJWT({ sub: 'creds-derived-id' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer('test')
      .setSubject('creds-derived-id')
      .setAudience('test')
      .sign(key)
    const ctx: SelfResolverContext = {
      identity: { name: 'alice', subject: 'alice', createdAt: 'x' },
      instanceSlug: 'kernel',
      credsJwt: jwt,
      instanceSigned: false,
    }
    const r = resolveSelfNodeId(ctx)
    expect(r).toEqual({ id: 'creds-derived-id' })
  })

  test('manager identity WITH registrations → uses registration sub (not refused)', () => {
    const ctx: SelfResolverContext = {
      identity: {
        name: 'manager',
        subject: 'manager',
        createdAt: 'x',
        registrations: {
          'some-child': { iss: 'x', sub: 'mgr-node-id-on-child', registeredAt: 'x' },
        },
      },
      instanceSlug: 'some-child',
      instanceSigned: false,
    }
    const r = resolveSelfNodeId(ctx)
    expect(r).toEqual({ id: 'mgr-node-id-on-child' })
  })
})

// ── Error builder ────────────────────────────────────────────

describe('selfRefusalError', () => {
  test('manager refusal carries metadata + actionable message', () => {
    const e = selfRefusalError({ reason: 'manager' })
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('SelfRefusalError')
    expect(e.message).toContain('bootstrap `manager` identity')
    expect(e.message).toContain('astrale identity create')
    expect((e as Error & { selfRefusal?: { reason: string } }).selfRefusal?.reason).toBe('manager')
  })

  test('no-registration message references the specific identity + slug', () => {
    const e = selfRefusalError({
      reason: 'no-registration',
      identityName: 'alice',
      instanceSlug: 'kernel-aidev',
    })
    expect(e.message).toContain('alice')
    expect(e.message).toContain('kernel-aidev')
    expect(e.message).toContain('astrale identity register alice -i kernel-aidev')
  })

  test('instance-signed message hints at --as', () => {
    const e = selfRefusalError({ reason: 'instance-signed', instanceSlug: 'child' })
    expect(e.message).toContain('--as')
    expect(e.message).toContain('child')
  })

  test('url-no-slug message hints at -i', () => {
    const e = selfRefusalError({ reason: 'url-no-slug' })
    expect(e.message).toContain('-i')
  })

  test('creds-no-sub message hints at literal @<nodeId>', () => {
    const e = selfRefusalError({ reason: 'creds-no-sub' })
    expect(e.message).toContain('@<nodeId>')
  })
})

// ── Helpers ──────────────────────────────────────────────────

async function generateEs256(): Promise<CryptoKey> {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  return pair.privateKey
}
