import { invocation } from '@astrale-os/sdk/invocation'

import { AdminContract, callAdminMethod } from '../../src/admin/contract.js'
import { withAdminClientSession } from '../../src/connection/session.js'
import { derivedIdempotencyKey } from '../../src/lib/idempotency.js'

const operationId = required('ASTRALE_E2E_OPERATION_ID')
const transportKey = await derivedIdempotencyKey('e2e.resume-instance', operationId)
const slug = required('ASTRALE_E2E_INSTANCE_SLUG')
const result = await withAdminClientSession({}, async ({ session }) => {
  return callAdminMethod(
    session,
    AdminContract.fleet,
    'createInstance',
    { operationId, slug },
    {
      idempotencyKey: invocation.acceptIdempotencyKey(transportKey),
      timeoutMs: 15 * 60_000,
    },
  )
})

console.log(JSON.stringify(result, null, 2))

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`)
  return value
}
