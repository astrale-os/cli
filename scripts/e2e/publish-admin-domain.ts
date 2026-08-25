import { invocation } from '@astrale-os/sdk/invocation'

import {
  bindAdmin,
  invokeAdminMethod,
  requireAdminClass,
  requireAdminCore,
} from '../../src/admin/binding.js'
import { withAdminClientSession } from '../../src/connection/session.js'

const operationId = required('ASTRALE_E2E_OPERATION_ID')
const result = await withAdminClientSession({}, async ({ session }) => {
  const admin = await bindAdmin(session)
  const Fleet = requireAdminClass(admin, 'Fleet', 'node')
  const fleet = requireAdminCore(admin, 'fleet')
  return invokeAdminMethod(
    session,
    admin,
    Fleet,
    'publishDomain',
    fleet,
    {
      operationId,
      origin: required('ASTRALE_E2E_DOMAIN_ORIGIN'),
      name: required('ASTRALE_E2E_DOMAIN_NAME'),
      discoveryUrl: required('ASTRALE_E2E_DOMAIN_DISCOVERY_URL'),
    },
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
