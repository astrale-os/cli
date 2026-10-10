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

/** Real SDK discovery and Invocation2 admission; only the remote Kernel owner is doubled. */
export async function fulfillKernel(route: Route): Promise<void> {
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
  if (String(sent.call.target) !== '/:kernel.astrale.ai:class.Identity:whoami')
    throw new Error('Unexpected Kernel call in Viewer fixture.')
  await route.fulfill({
    contentType: 'application/vnd.astrale+json',
    headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
    json: {
      requestId: sent.requestId,
      invocation: { source: kernel, id: 'viewer-whoami' },
      result: {
        id: 'fixture',
        iss: kernel,
        sub: 'fixture',
        frozen: false,
        requiredClaims: [],
      },
    },
  })
}
