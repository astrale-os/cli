import { bindDomain } from '@astrale-os/shell'

import { withAdminClientSession } from '../../src/connection/session.ts'

const operationId = required('ASTRALE_E2E_OPERATION_ID')
const slug = required('ASTRALE_E2E_INSTANCE_SLUG')
const result = await withAdminClientSession({}, async ({ session }) => {
  const installed = await session.installation('admin.astrale.ai')
  const admin = await bindDomain(session, installed.bundle.root)
  const fleet = admin.$.core.nodes.fleet?.path
  if (fleet === undefined) throw new Error('Installed Admin Domain has no Fleet core receiver.')
  return admin.$.invoke(
    admin.$.class('Fleet').$.method('createInstance') as never,
    fleet,
    { operationId, slug } as never,
    { idempotencyKey: operationId.replaceAll(':', '-'), timeoutMs: 15 * 60_000 },
  )
})

console.log(JSON.stringify(result, null, 2))

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`)
  return value
}
