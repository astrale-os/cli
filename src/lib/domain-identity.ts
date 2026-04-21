import { importJWK, SignJWT } from 'jose'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type Spec = { nodes: SpecNode[]; edges: SpecEdge[] }
type SpecNode = {
  slug: string
  class?: string | { raw: string }
  properties: Record<string, unknown>
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
): Promise<IdentityBinding> {
  const slug = extractDomainSlug(spec)
  const subs = collectFunctionSubs(spec, slug)

  const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...publicJwk } = privateJwk

  const alg = privateJwk.alg as string
  const kid = privateJwk.kid as string
  const key = await importJWK(privateJwk, alg)

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

const DOMAIN_CLASS = '/:kernel.astrale.ai:class.Domain'
const METHOD_OF_CLASS = '/:kernel.astrale.ai:class.method_of'

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
  return (domainNode.properties.origin as string) ?? domainNode.slug
}

/**
 * Collect function subs as domain-relative paths (e.g. `/Class/method`).
 *
 * Per RFC 7519 `sub` is scoped to `iss`, so the kernel's
 * `stripDomainPrefix` (kernel/runtime/domains/identity.ts) expects
 * relative paths — not absolute. Both sides must match exactly.
 */
function collectFunctionSubs(spec: Spec, slug: string): string[] {
  const prefix = `/${slug}`
  const subs: string[] = []
  for (const edge of spec.edges) {
    const cls = rawStr(edge.class)
    if (cls !== METHOD_OF_CLASS && cls !== `${METHOD_OF_CLASS}/self`) continue
    const source = rawStr(edge.source)
    if (!source) continue
    const absolute = source.startsWith('./') ? '/' + source.slice(2) : source
    if (!absolute.startsWith(`${prefix}/`)) continue
    subs.push(absolute.slice(prefix.length))
  }
  return subs
}
