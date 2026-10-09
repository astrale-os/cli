import { MethodKey } from '@astrale-os/sdk/schema'

import { AdminContract, callAdminMethod } from '../../src/admin/contract.js'
import { withAdminClientSession } from '../../src/connection/session.js'

const operationId = required('ASTRALE_E2E_OPERATION_ID')
const slug = required('ASTRALE_E2E_INSTANCE_SLUG')
const result = await withAdminClientSession({}, async ({ session }) => {
  return callAdminMethod(
    session,
    AdminContract.fleet,
    MethodKey('admin.astrale.ai:class.Fleet.method.createInstance'),
    { operationId, slug },
    { timeoutMs: 15 * 60_000 },
  )
})

console.log(JSON.stringify(result, null, 2))

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`)
  return value
}
