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

  const alg = privateJwk.alg as string
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
const CLASS_NS_PREFIX = 'class.'

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
 * Collect expected function subs as absolute `MethodPath` strings
 * (`/:origin:Member:method`). Must match what the kernel computes via
 * `resolveMethodNodes` over `compiled.$.paths.absolute` — only methods
 * declared by this domain's own classes, skipping inherited ones.
 *
 * Edge target forms accepted:
 *   - tree form:  `/<origin>/class.<member>/self` (legacy spec builder)
 *   - typed form: `/:<origin>:class.<member>` (current spec builder)
 */
function collectFunctionSubs(spec: Spec, origin: string): string[] {
  const selfSuffix = '/self'
  const treeOriginPrefix = `/${origin}/`
  const typedOriginPrefix = `/:${origin}:`
  const subs = new Set<string>()
  for (const edge of spec.edges) {
    const cls = rawStr(edge.class)
    if (cls !== METHOD_OF_CLASS && cls !== `${METHOD_OF_CLASS}/self`) continue
    const target = rawStr(edge.target)
    const source = rawStr(edge.source)
    if (!target || !source) continue
    if (!source.startsWith(treeOriginPrefix)) continue
    let member: string | undefined
    if (target.startsWith(treeOriginPrefix) && target.endsWith(selfSuffix)) {
      member = target.slice(treeOriginPrefix.length, target.length - selfSuffix.length)
    } else if (target.startsWith(typedOriginPrefix)) {
      member = target.slice(typedOriginPrefix.length)
    }
    if (!member || !member.startsWith(CLASS_NS_PREFIX)) continue
    const methodName = source.slice(source.lastIndexOf('/') + 1)
    if (!methodName) continue
    subs.add(`/:${origin}:${member}:${methodName}`)
  }
  return [...subs]
}
