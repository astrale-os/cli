import { ResponseError } from '@astrale-os/sdk/client'
import { expect, test } from 'bun:test'

import { failureExitCode, IncompleteInstallation } from '../installation-result'

function installation(state: string, outcome?: unknown) {
  return {
    execution: 'execution-1',
    status: { id: 'execution-1', state, ...(outcome === undefined ? {} : { outcome }) },
  } as never
}

test('an installation that ended failed exits 2, the PRD exit of a rejected install', () => {
  const failed = installation('failed', {
    kind: 'failed',
    error: { code: 'DATA_MIGRATION_REQUIRED', message: 'Repair stored data.' },
  })
  expect(failureExitCode(new IncompleteInstallation(failed))).toBe(2)
  expect(failureExitCode(new IncompleteInstallation(failed, 'uninstall'))).toBe(2)
})

test('an unfinished, cancelled or non-installation failure keeps exit 1', () => {
  expect(failureExitCode(new IncompleteInstallation(installation('running')))).toBe(1)
  expect(
    failureExitCode(new IncompleteInstallation(installation('cancelled', { kind: 'cancelled' }))),
  ).toBe(1)
  expect(failureExitCode(new Error('transport failed'))).toBe(1)
})

test('a refusal while another schema change is active exits 5, the client spec conflict code', () => {
  const active = new ResponseError(
    4001 as never,
    'A session or another install or uninstall is changing the schema; retry after it ends.',
    { source: 'https://kernel.test', id: 'install' } as never,
    { code: 'SCHEMA_CHANGE_ACTIVE', details: {} } as never,
  )
  expect(failureExitCode(active)).toBe(5)
})
