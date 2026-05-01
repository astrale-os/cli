import { exportJWK, importJWK, SignJWT } from 'jose'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { AstraleError } from '../errors'

type Spec = { nodes: SpecNode[]; edges: SpecEdge[] }
type SpecNode = {
  path?: string
  class?: string | { raw: string }
  props: Record<string, unknown>
}
type SpecEdge = {
  class?: string | { raw: string }
  source: string | { raw: string }
  target: string | { raw: string }
}

type IdentityBinding = {
  credential: string
  publicKey: { jwk: Record<string, unknown> }
}

export async function loadPrivateJwk(keyPath: string): Promise<Record<string, unknown>> {
  const filePath = resolve(keyPath)
  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

export async function buildIdentityBinding(
  spec: Spec,
  privateJwk: Record<string, unknown>,
  keyPath?: string,
): Promise<IdentityBinding> {
  const slug = extractDomainSlug(spec)
  const subs = collectFunctionSubs(spec, slug)

  const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...publicJwk } = privateJwk

  const alg = inferAlg(privateJwk, keyPath)
  const kid = privateJwk.kid as string
  // `extractable: true` lets us re-export the private JWK to derive its
  // canonical public half and cross-check against the `x`/`y` shipped in
  // the file — historical templates had mismatched public components which
  // made every downstream `signature verification failed` impossible to
  // diagnose from the error alone.
  const key = await importJWK(privateJwk, alg, { extractable: true })
  await assertKeyPairConsistent(key, publicJwk, keyPath)

  const credential = await new SignJWT({ subs })
    .setProtectedHeader({ alg, kid })
    .setIssuer(slug)
    .setSubject(slug)
    .setAudience(slug)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key)

  return { credential, publicKey: { jwk: publicJwk } }
}

/**
 * Resolve the JOSE algorithm to use with this key. Prefers `privateJwk.alg`
 * when present, falls back to inferring from `crv`/`kty` so keys generated
 * by older CLIs (which didn't stamp `alg`) keep working without manual
 * editing — see META_TRACE #34. Throws a clean error if neither path
 * resolves an algorithm.
 */
export function inferAlg(privateJwk: Record<string, unknown>, keyPath?: string): string {
  const explicit = privateJwk.alg
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const crv = privateJwk.crv
  const kty = privateJwk.kty
  if (kty === 'EC' && crv === 'P-256') return 'ES256'
  if (kty === 'OKP' && crv === 'Ed25519') return 'EdDSA'
  const where = keyPath ? ` at ${keyPath}` : ''
  throw new AstraleError(
    'INVALID_KEY_FILE',
    `JWK${where} is missing both \`alg\` and a recognizable \`(kty, crv)\` pair — cannot pick a signing algorithm.`,
    'Re-stamp the file with `"alg": "ES256"` (P-256 EC keys) or `"alg": "EdDSA"` (Ed25519 OKP keys), or regenerate via `astrale domain init` / `astrale identity create`.',
  )
}

/**
 * Cross-check the public components in the file against what can be
 * derived from the private scalar. Catches broken pairs (`d` and `x` from
 * two different keypairs) before they bubble up as a server-side
 * `signature verification failed`.
 */
async function assertKeyPairConsistent(
  key: Parameters<typeof exportJWK>[0],
  fileJwk: Record<string, unknown>,
  keyPath?: string,
): Promise<void> {
  let derived: Record<string, unknown>
  try {
    derived = (await exportJWK(key)) as Record<string, unknown>
  } catch {
    // exportJWK can only fail on non-extractable keys. We imported with
    // `extractable: true` so this is effectively unreachable — swallow
    // and let the downstream verify produce its own error if it hits one.
    return
  }
  const publicFields = ['x', 'y', 'n', 'e'] as const
  for (const field of publicFields) {
    if (derived[field] === undefined) continue
    if (fileJwk[field] !== undefined && fileJwk[field] !== derived[field]) {
      const where = keyPath ? ` at ${keyPath}` : ''
      throw new AstraleError(
        'INVALID_KEY_PAIR',
        `Private and public components don't match${where} — field \`${field}\` derived from \`d\` is "${String(derived[field])}" but the file says "${String(fileJwk[field])}".`,
        'Regenerate the pair (e.g. delete worker/src/keys.ts and re-scaffold via `astrale domain init`), or replace both halves with a matching keypair.',
      )
    }
  }
}

const DOMAIN_CLASS = '/:kernel.astrale.ai:class.Domain'
const METHOD_OF_CLASS = '/:kernel.astrale.ai:class.method_of'
// Both buckets are valid `method_of` targets — Function methods can be hosted
// on either a `class.X` or an `interface.X`. The kernel computes function
// paths identically for both (`/:<origin>:<member>:<method>`), so the CLI
// must emit subs for both kinds; emitting only `class.` silently drops
// interface-hosted methods and the kernel rejects with
// `subs missing function path "/:<origin>:interface.X:<method>"`.
const MEMBER_NS_PREFIXES = ['class.', 'interface.'] as const

function rawStr(value: string | { raw: string } | undefined): string | undefined {
  if (!value) return undefined
  return typeof value === 'string' ? value : value.raw
}

function extractDomainSlug(spec: Spec): string {
  const domainNode = spec.nodes.find((n) => {
    const cls = rawStr(n.class)
    return cls === DOMAIN_CLASS || cls === `${DOMAIN_CLASS}/self`
  })
  if (!domainNode) throw new Error('No Domain node found in spec')
  const origin = domainNode.props?.origin
  if (typeof origin === 'string' && origin.length > 0) return origin
  const path = domainNode.path
  if (typeof path === 'string' && path.startsWith('/')) return path.slice(1)
  throw new Error('Domain node has no origin or path')
}

/**
 * Extract `(member, method)` from a `method_of` edge endpoint that points
 * at a Function. Accepts both wire forms emitted by the DSL builder over
 * its lifetime:
 *   - tree:  `/<origin>/<member>/<method>`  (segment separator `/`, legacy)
 *   - typed: `/:<origin>:<member>:<method>` (segment separator `:`, current)
 * Returns `undefined` when the prefix doesn't match this origin or when
 * either member or method is empty.
 */
function parseFunctionEndpoint(
  s: string,
  treeOriginPrefix: string,
  typedOriginPrefix: string,
): { member: string; method: string } | undefined {
  let tail: string
  let sep: string
  if (s.startsWith(treeOriginPrefix)) {
    tail = s.slice(treeOriginPrefix.length)
    sep = '/'
  } else if (s.startsWith(typedOriginPrefix)) {
    tail = s.slice(typedOriginPrefix.length)
    sep = ':'
  } else {
    return undefined
  }
  const idx = tail.indexOf(sep)
  if (idx <= 0 || idx === tail.length - 1) return undefined
  return { member: tail.slice(0, idx), method: tail.slice(idx + 1) }
}

/**
 * Collect expected function subs as absolute `MethodPath` strings
 * (`/:origin:Member:method`). Must match what the kernel computes via
 * `resolveMethodNodes` over `compiled.$.paths.absolute` — only methods
 * declared by this domain's own classes/interfaces, skipping inherited ones.
 *
 * Both wire forms (tree + typed) are accepted on the source side; the
 * source already encodes both member and method, so the target is
 * checked only for class membership filter via `MEMBER_NS_PREFIXES`.
 */
export function collectFunctionSubs(spec: Spec, origin: string): string[] {
  const treeOriginPrefix = `/${origin}/`
  const typedOriginPrefix = `/:${origin}:`
  const subs = new Set<string>()
  for (const edge of spec.edges) {
    const cls = rawStr(edge.class)
    if (cls !== METHOD_OF_CLASS && cls !== `${METHOD_OF_CLASS}/self`) continue
    const source = rawStr(edge.source)
    if (!source) continue
    const parsed = parseFunctionEndpoint(source, treeOriginPrefix, typedOriginPrefix)
    if (!parsed) continue
    if (!MEMBER_NS_PREFIXES.some((p) => parsed.member.startsWith(p))) continue
    subs.add(`/:${origin}:${parsed.member}:${parsed.method}`)
  }
  return [...subs]
}
