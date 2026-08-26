import { Path } from '@astrale-os/sdk/graph/path'
import { invocation } from '@astrale-os/sdk/invocation'

import { callAdminMethod } from '../../src/admin/contract.js'
import { withAdminClientSession } from '../../src/connection/session.js'

const operationId = required('ASTRALE_E2E_OPERATION_ID')
const host = Path.parse(required('ASTRALE_E2E_HOST'))
const principal = Path.parse(required('ASTRALE_E2E_PRINCIPAL')).raw
const result = await withAdminClientSession({}, async ({ session }) => {
  return callAdminMethod(
    session,
    host,
    'assignPrincipal',
    { operationId, principal },
    {
      idempotencyKey: invocation.acceptIdempotencyKey(operationId.replaceAll(':', '-')),
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
