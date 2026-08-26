import type { Transport } from '@astrale-os/sdk/client'

import { issuer } from '@astrale-os/sdk/auth'
import { call, Client } from '@astrale-os/sdk/client'
import { ClientSession } from '@astrale-os/sdk/client/session'
import { NodeId } from '@astrale-os/sdk/graph/node'
import { Path } from '@astrale-os/sdk/graph/path'
import { invocation } from '@astrale-os/sdk/invocation'

import { FileSessionRouteStore } from '../../session-routes'

const routePath = process.argv[2]
if (routePath === undefined) throw new Error('route artifact path is required')

const sourceEndpoint = 'https://source.kernel.test/invoke'
const sourceIssuer = issuer.accept('https://source.kernel.test')
const destinationEndpoint = 'https://destination.application.test/invoke'
const target = Path.id(NodeId('session-route-fresh-process'))
let sourceAttempts = 0
let destinationAttempts = 0

const route = invocation.acceptRoute({
  endpoint: { http: destinationEndpoint },
  via: {
    kind: 'via',
    issuer: sourceIssuer,
    publication: {
      origin: 'destination.application.test',
      identity: {
        issuer: 'https://destination.application.test',
        subject: 'destination.application.test',
      },
      revision: `sha256:${'1'.padStart(64, '0')}`,
      etag: `sha256:${'1'.padStart(64, '0')}`,
    },
  },
})
const carrier = `e30.${Buffer.from(
  JSON.stringify({ exp: Math.floor(Date.now() / 1_000) + 600 }),
).toString('base64url')}.signature`
const sourceDispatch: Transport['dispatch'] = async () => {
  sourceAttempts += 1
  return {
    kind: 'redirect',
    invocation: { source: sourceIssuer, id: 'source-invocation' },
    redirect: { route, credential: carrier },
  }
}
const destinationDispatch: Transport['dispatch'] = async () => {
  destinationAttempts += 1
  return {
    kind: 'value',
    value: 'done',
    invocation: { source: sourceIssuer, id: 'destination-invocation' },
  }
}
const source = new Client({ transport: { dispatch: sourceDispatch } })
const destination = new Client({ transport: { dispatch: destinationDispatch } })
const session = new ClientSession({
  kernel: sourceIssuer,
  fetch: async () =>
    new Response(
      JSON.stringify({
        protocol: 'astrale-invocation',
        version: 1,
        issuer: sourceIssuer,
        endpoints: { http: sourceEndpoint },
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  pool: {
    clientFor(
      target: Parameters<
        NonNullable<ConstructorParameters<typeof ClientSession>[0]['pool']>['clientFor']
      >[0],
    ) {
      const url = target.transport === 'auto' ? target.endpoints.http : target.url
      return url === sourceEndpoint ? source : destination
    },
  },
  auth: { ttlSeconds: 120, resolve: () => ({ credential: 'source-credential' }) },
  routeStore: new FileSessionRouteStore(routePath),
  policy: { maximumRouteAgeMs: 60_000 },
})

try {
  const value = await session.call(call(target, null))
  console.log(JSON.stringify({ value, sourceAttempts, destinationAttempts }))
} finally {
  session.close()
  source.close()
  destination.close()
}
