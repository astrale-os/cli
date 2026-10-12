/**
 * Subprocess fixture for credential.test.ts: an expired IdP session whose refresh lock the
 * filesystem refuses with the code given as the first argument. The refusal is injected at the
 * lock's `open`, as the platform raises it, so the scenario holds when the tests run as root.
 *
 * Env: ASTRALE_HOME (required). Stdout: the resolved error's code, message and hint as JSON.
 */
import { spyOn } from 'bun:test'
import * as fsPromises from 'node:fs/promises'

import type { AstraleConfig } from '../../../lib/config'

import { upsertIdpIdentity } from '../../../identity/registry'
import { idpSessionPath, saveIdpSession } from '../../../lib/idp/provider'
import { resolveCredential } from '../../auth'

const KERNEL = 'https://kernel.example'
const SOURCE_ISSUER = 'https://workos.example'
const config: AstraleConfig = {
  issuer: 'https://cli.example',
  admin: { name: 'admin', url: KERNEL, kernelIssuer: KERNEL },
  telemetry: { enabled: false, analyzerEnabled: false },
  browser: {},
}
const code = process.argv[2] ?? 'EACCES'

await upsertIdpIdentity('alice', {
  subject: 'source-alice',
  idp: 'workos',
  issuer: SOURCE_ISSUER,
  use: true,
})
await saveIdpSession({
  identity: 'alice',
  idp: 'workos',
  issuer: SOURCE_ISSUER,
  subject: 'source-alice',
  access_token: 'expired-source-token',
  refresh_token: 'refresh-token-must-not-be-spent',
  expires_at: '2026-01-01T00:00:00.000Z',
  updatedAt: new Date().toISOString(),
})

const lockPath = `${idpSessionPath('alice')}.lock`
const realOpen = fsPromises.open
spyOn(fsPromises, 'open').mockImplementation((async (...args: Parameters<typeof realOpen>) => {
  if (args[0] !== lockPath) return realOpen(...args)
  throw Object.assign(new Error(`${code}: refused, open '${lockPath}'`), {
    code,
    syscall: 'open',
    path: lockPath,
  })
}) as typeof realOpen)

const failure = await resolveCredential({ as: 'alice' }, config, KERNEL).then(
  () => ({ resolved: true }),
  (error: { code?: string; message: string; hint?: string }) => ({
    code: error.code,
    message: error.message,
    hint: error.hint,
  }),
)
console.log(JSON.stringify({ ...failure, lockPath }))
