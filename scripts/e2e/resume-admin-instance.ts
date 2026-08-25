import { invocation } from '@astrale-os/sdk/invocation'

import {
  bindAdmin,
  invokeAdminMethod,
  requireAdminClass,
  requireAdminCore,
} from '../../src/admin/binding.js'
import { withAdminClientSession } from '../../src/connection/session.js'

const operationId = required('ASTRALE_E2E_OPERATION_ID')
const slug = required('ASTRALE_E2E_INSTANCE_SLUG')
const result = await withAdminClientSession({}, async ({ session }) => {
  const admin = await bindAdmin(session)
  const Fleet = requireAdminClass(admin, 'Fleet', 'node')
  const fleet = requireAdminCore(admin, 'fleet')
  return invokeAdminMethod(
    session,
    admin,
    Fleet,
    'createInstance',
    fleet,
    { operationId, slug },
    {
      idempotencyKey: invocation.acceptIdempotencyKey(operationId.replaceAll(':', '-')),
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
