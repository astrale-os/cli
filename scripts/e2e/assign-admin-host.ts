import { bind } from '@astrale-os/kernel-client/domain'
import { Path } from '@astrale-os/sdk/graph/path'

import { withAdminClientSession } from '../../src/connection/session.ts'

const operationId = required('ASTRALE_E2E_OPERATION_ID')
const host = Path.parse(required('ASTRALE_E2E_HOST'))
const principal = Path.parse(required('ASTRALE_E2E_PRINCIPAL')).raw
const result = await withAdminClientSession({}, async ({ session }) => {
  const admin = await bind(session, await session.installed('admin.astrale.ai'))
  return admin.$.invoke(
    admin.$.class('Host').$.method('assignPrincipal') as never,
    host,
    { operationId, principal } as never,
    { idempotencyKey: operationId.replaceAll(':', '-'), timeoutMs: 120_000 },
  )
})

console.log(JSON.stringify(result, null, 2))

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`)
  return value
}
