import { invocation } from '@astrale-os/sdk/invocation'

import { AdminContract, callAdminMethod } from '../../src/admin/contract.js'
import { withAdminClientSession } from '../../src/connection/session.js'

const operationId = required('ASTRALE_E2E_OPERATION_ID')
const result = await withAdminClientSession({}, async ({ session }) => {
  return callAdminMethod(
    session,
    AdminContract.fleet,
    'provisionHost',
    {
      id: required('ASTRALE_E2E_HOST_ID'),
      operationId,
      label: required('ASTRALE_E2E_HOST_LABEL'),
      capacityLimit: integer('ASTRALE_E2E_HOST_CAPACITY', 5),
      release: required('ASTRALE_E2E_HOST_RELEASE'),
      provider: {
        kind: 'scaleway',
        projectId: required('ASTRALE_E2E_SCALEWAY_PROJECT_ID'),
        zone: process.env.ASTRALE_E2E_SCALEWAY_ZONE ?? 'fr-par-1',
        commercialType: process.env.ASTRALE_E2E_SCALEWAY_TYPE ?? 'DEV1-M',
        image: process.env.ASTRALE_E2E_SCALEWAY_IMAGE ?? 'ubuntu_noble',
        rootVolumeSizeGb: integer('ASTRALE_E2E_ROOT_VOLUME_GB', 20),
      },
      bootstrap: { authenticationTrust: { default: 'allow' } },
    },
    { idempotencyKey: invocation.acceptIdempotencyKey(operationId), timeoutMs: 15 * 60_000 },
  )
})

console.log(JSON.stringify(result, null, 2))

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`)
  return value
}

function integer(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be positive.`)
  return value
}
