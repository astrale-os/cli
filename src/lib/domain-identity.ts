import { importJWK, SignJWT } from 'jose'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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
 */
function collectFunctionSubs(spec: Spec, origin: string): string[] {
  const selfSuffix = '/self'
  const classPrefix = `/${origin}/${CLASS_NS_PREFIX}`
  const subs = new Set<string>()
  for (const edge of spec.edges) {
    const cls = rawStr(edge.class)
    if (cls !== METHOD_OF_CLASS && cls !== `${METHOD_OF_CLASS}/self`) continue
    const target = rawStr(edge.target)
    const source = rawStr(edge.source)
    if (!target || !source) continue
    if (!source.startsWith(classPrefix)) continue
    if (!target.startsWith(classPrefix) || !target.endsWith(selfSuffix)) continue
    const member = target.slice(classPrefix.length, target.length - selfSuffix.length)
    if (!member) continue
    const methodName = source.slice(source.lastIndexOf('/') + 1)
    if (!methodName) continue
    subs.add(`/:${origin}:${member}:${methodName}`)
  }
  return [...subs]
}
