import type { Route } from '@playwright/test'

import { invocation } from '@astrale-os/sdk/invocation'
import { describeBundle, encode, MEDIA_TYPE, seal } from '@astrale-os/sdk/release'
import { bundle, KernelSchema, schema } from '@astrale-os/sdk/schema'

const kernel = 'https://kernel.example'
const artifact = bundle.create(KernelSchema)
const schemaBundle = bundle.encode(artifact)
const release = seal({
  format: 'astrale.domain.release',
  version: 4,
  origin: KernelSchema.origin,
  identity: {
    issuer: invocation.acceptInvocationId({ source: kernel, id: 'viewer-fixture' }).source,
    subject: KernelSchema.origin,
  },
  build: { digest: `sha256:${'b'.repeat(64)}` },
  schema: {
    revision: schema.revision(KernelSchema),
    bundle: describeBundle(artifact, `${kernel}/bundle`),
  },
  requirements: { capabilities: {} },
  bindings: { callables: [], views: [] },
  routes: [],
} as Parameters<typeof seal>[0])
export const kernelRevision = release.schema.revision

/** A call the fixture answers besides `whoami`: its result, or nothing for a call it refuses. */
export type KernelAnswer = (call: { readonly target: string; readonly input: unknown }) => unknown

/** A binary result, sent as the Kernel sends one: the bytes, their media type, and the fields. */
export class BinaryAnswer {
  constructor(
    readonly mediaType: string,
    readonly body: Uint8Array,
  ) {}
}

const INTROSPECT = '/:kernel.astrale.ai:function.introspect'
// The Kernel's Schema introspection evidence; the SDK reads it but does not export its codec.
const INTROSPECTION_MEDIA_TYPE = 'application/vnd.astrale.schema-introspection.v4+json'

/** The Kernel's Schema introspection of one installed Domain: its Bundle, from no Release. */
export function introspection(domain: schema.DomainSchema): KernelAnswer {
  const evidence = new TextEncoder().encode(
    JSON.stringify({
      domain: {
        origin: domain.origin,
        revision: schema.revision(domain),
        generation: `sha256:${'e'.repeat(64)}`,
        release: null,
        readiness: `sha256:${'f'.repeat(64)}`,
        capabilities: { requested: {}, materialized: {} },
        bindings: { callables: [], views: [] },
      },
      bundle: bundle.serialize(bundle.create(domain)),
    }),
  )
  return ({ target, input }) => {
    const request = input as { readonly kind?: unknown; readonly origin?: unknown } | null
    if (target !== INTROSPECT || request?.kind !== 'bundle' || request.origin !== domain.origin)
      return undefined
    return new BinaryAnswer(INTROSPECTION_MEDIA_TYPE, evidence)
  }
}

/** Real SDK discovery and Invocation2 admission; only the remote Kernel owner is doubled. */
export function fulfillKernel(route: Route): Promise<void> {
  return fulfill(route, undefined)
}

/** The same Kernel, answering other calls too. */
export function answeringKernel(answer: KernelAnswer): (route: Route) => Promise<void> {
  return (route) => fulfill(route, answer)
}

async function fulfill(route: Route, answer: KernelAnswer | undefined): Promise<void> {
  const request = route.request()
  const url = new URL(request.url())
  if (request.frame().parentFrame() !== null)
    throw new Error('A View requested Kernel data during initialization.')
  if (url.pathname === '/.well-known/astrale/release.json') {
    const unchanged = request.headers()['if-none-match'] === `"${release.digest}"`
    await route.fulfill({
      status: unchanged ? 304 : 200,
      headers: {
        'content-type': MEDIA_TYPE,
        etag: `"${release.digest}"`,
        'access-control-allow-origin': '*',
      },
      ...(unchanged ? {} : { body: Buffer.from(encode(release)) }),
    })
    return
  }
  if (url.pathname === '/bundle') {
    await route.fulfill({
      contentType: release.schema.bundle.ref.mediaType,
      headers: { 'access-control-allow-origin': '*' },
      body: Buffer.from(schemaBundle),
    })
    return
  }
  if (request.method() === 'OPTIONS') {
    await route.fulfill({
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
      },
    })
    return
  }
  const sent = invocation.decodeRequest(request.postDataJSON())
  if (sent.credential !== 'kernel-fixture')
    throw new Error('Host used a child credential at the Kernel.')
  const target = String(sent.call.target)
  const result =
    target === '/:kernel.astrale.ai:class.Identity:whoami'
      ? { id: 'fixture', iss: kernel, sub: 'fixture', frozen: false, requiredClaims: [] }
      : answer?.({ target, input: sent.call.input })
  if (result === undefined) throw new Error(`Unexpected Kernel call in Viewer fixture: ${target}`)
  if (result instanceof BinaryAnswer) {
    const { http } = invocation
    const fields = [http.REQUEST_ID_FIELD, http.BINARY_HEADERS_FIELD, http.INVOCATION_FIELD]
    await route.fulfill({
      contentType: result.mediaType,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-expose-headers': fields.join(', '),
        'cache-control': 'no-store',
        [http.REQUEST_ID_FIELD]: String(sent.requestId),
        [http.BINARY_HEADERS_FIELD]: http.encodeBinaryHeaderNames({}),
        [http.INVOCATION_FIELD]: http.encodeInvocationId(
          invocation.acceptInvocationId({ source: kernel, id: 'viewer-call' }),
        ),
      },
      body: Buffer.from(result.body),
    })
    return
  }
  await route.fulfill({
    contentType: 'application/vnd.astrale+json',
    headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
    json: { requestId: sent.requestId, invocation: { source: kernel, id: 'viewer-call' }, result },
  })
}
