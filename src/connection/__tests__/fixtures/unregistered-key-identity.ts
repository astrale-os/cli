/**
 * Subprocess fixture for credential.test.ts: a key identity registered on one Kernel only, with no
 * issuer of its own, resolved for that Kernel and for another one, under the unconfigured CLI
 * issuer and under a configured one.
 *
 * Env: ASTRALE_HOME (required). Stdout: the refusal and the signed claims as JSON.
 */
import { credential as inspect, issuer } from '@astrale-os/sdk/auth'

import { createIdentity, setRegistration } from '../../../identity/registry'
import { DEFAULT_CONFIG } from '../../../lib/config'
import { resolveCredential } from '../../auth'

const REGISTERED = issuer.accept('https://registered.example/api')
const OTHER = issuer.accept('https://other.example/api')

await createIdentity('ci')
await setRegistration('ci', REGISTERED, {
  iss: `${REGISTERED}/iss/thumbprint`,
  sub: 'self',
  registeredAt: new Date().toISOString(),
})

const claims = async (config: typeof DEFAULT_CONFIG, kernel: string) => {
  const { iss, sub } = inspect.inspect(
    await resolveCredential({ as: 'ci' }, config, kernel, kernel),
  )
  return { iss, sub }
}
const refused = await resolveCredential({ as: 'ci' }, DEFAULT_CONFIG, OTHER, OTHER).then(
  () => ({ resolved: true }),
  (error: { code?: string; message: string; hint?: string }) => ({
    code: error.code,
    message: error.message,
    hint: error.hint,
  }),
)

console.log(
  JSON.stringify({
    refused,
    registered: await claims(DEFAULT_CONFIG, REGISTERED),
    configured: await claims({ ...DEFAULT_CONFIG, issuer: 'https://cli.example' }, OTHER),
  }),
)
