import type { Route } from '@playwright/test'

import { MEDIA_TYPE } from '@astrale-os/sdk/release'
import { defineSchema } from '@astrale-os/sdk/schema'

import { deploymentReleaseFor } from '../../src/__tests__/fixtures/publication'

const kernel = 'https://kernel.example'
const release = deploymentReleaseFor(defineSchema('kernel.astrale.ai', {}), kernel)
export const kernelRevision = release.document.schema.revision

/** The host discovers the Kernel revision and names its own caller in the v2 handshake. */
export async function answerKernel(route: Route): Promise<boolean> {
  const url = new URL(route.request().url())
  if (url.origin !== kernel) return false
  if (route.request().frame().parentFrame() !== null)
    throw new Error('A View requested Kernel data during initialization.')
  if (url.pathname === '/.well-known/astrale/release.json') {
    await route.fulfill({
      contentType: MEDIA_TYPE,
      body: JSON.stringify(release.document),
    })
    return true
  }
  if (url.pathname === '/invoke') {
    const request = route.request().postDataJSON()
    if (request.credential !== 'kernel-fixture')
      throw new Error('Host used a child credential at the Kernel.')
    if (request.call.target !== '/:kernel.astrale.ai:class.Identity:whoami') {
      throw new Error(`Unexpected Kernel call: ${JSON.stringify(request.call)}`)
    }
    await route.fulfill({
      contentType: route.request().headers()['content-type'],
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({
        requestId: request.requestId,
        invocation: { source: kernel, id: 'browser-whoami' },
        result: {
          id: 'fixture',
          iss: kernel,
          sub: 'fixture',
          frozen: false,
          requiredClaims: [],
        },
      }),
    })
    return true
  }
  throw new Error(`Unexpected Kernel request: ${url.href}`)
}
