import { bindAdmin } from '../../src/admin/binding.ts'
import { withAdminClientSession } from '../../src/connection/session.ts'

const operationId = required('ASTRALE_E2E_OPERATION_ID')
const result = await withAdminClientSession({}, async ({ session }) => {
  const admin = await bindAdmin(session)
  const fleet = admin.$.core.nodes.fleet?.path
  if (fleet === undefined) throw new Error('Installed Admin Domain has no Fleet core receiver.')
  return admin.$.invoke(
    admin.$.class('Fleet').$.method('publishDomain') as never,
    fleet,
    {
      operationId,
      origin: required('ASTRALE_E2E_DOMAIN_ORIGIN'),
      name: required('ASTRALE_E2E_DOMAIN_NAME'),
      discoveryUrl: required('ASTRALE_E2E_DOMAIN_DISCOVERY_URL'),
    } as never,
    { idempotencyKey: operationId.replaceAll(':', '-'), timeoutMs: 120_000 },
  )
})

console.log(JSON.stringify(result, null, 2))

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`)
  return value
}
