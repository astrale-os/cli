import { invocation } from '@astrale-os/sdk/invocation'

import { AdminContract, callAdminMethod } from '../../src/admin/contract.js'
import { withAdminClientSession } from '../../src/connection/session.js'
import { derivedIdempotencyKey } from '../../src/lib/idempotency.js'

const operationId = required('ASTRALE_E2E_OPERATION_ID')
const transportKey = await derivedIdempotencyKey('e2e.publish-domain', operationId)
const result = await withAdminClientSession({}, async ({ session }) => {
  return callAdminMethod(
    session,
    AdminContract.fleet,
    'publishDomain',
    {
      operationId,
      origin: required('ASTRALE_E2E_DOMAIN_ORIGIN'),
      name: required('ASTRALE_E2E_DOMAIN_NAME'),
      discoveryUrl: required('ASTRALE_E2E_DOMAIN_DISCOVERY_URL'),
    },
    {
      idempotencyKey: invocation.acceptIdempotencyKey(transportKey),
      timeoutMs: 120_000,
    },
  )
})

console.log(JSON.stringify(result, null, 2))

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`)
  return value
}
