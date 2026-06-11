/**
 * Subprocess driver for idp-session.test.ts. `ensureFreshSession` resolves
 * paths through the import-time ASTRALE_HOME singleton, and `bun test` shares
 * one process across files, so session-touching scenarios run here — in a
 * fresh process whose ASTRALE_HOME the test controls.
 *
 * Usage: bun idp-session.driver.ts <ensure|ensure-concurrent>
 * Env: ASTRALE_HOME (required), DRIVER_AUDIENCE, DRIVER_ORG_ID
 * Stdout: one JSON line describing the outcome.
 */
import { accessTokenForAudience, classifyRefreshFailure } from '../idp'
import { ensureFreshSession } from '../idp-session'

const scenario = process.argv[2]
const audience = process.env.DRIVER_AUDIENCE || undefined
let orgHintCalls = 0
const resolveOrganizationId = async (): Promise<string | undefined> => {
  orgHintCalls += 1
  return process.env.DRIVER_ORG_ID || undefined
}

function print(result: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(result) + '\n')
}

try {
  if (scenario === 'ensure') {
    const session = await ensureFreshSession('alice', { audience, resolveOrganizationId })
    print({ ok: true, token: accessTokenForAudience(session, audience), orgHintCalls })
  } else if (scenario === 'ensure-concurrent') {
    const [a, b] = await Promise.all([
      ensureFreshSession('alice', { audience, resolveOrganizationId }),
      ensureFreshSession('alice', { audience, resolveOrganizationId }),
    ])
    print({
      ok: true,
      tokens: [accessTokenForAudience(a, audience), accessTokenForAudience(b, audience)],
      orgHintCalls,
    })
  } else {
    throw new Error(`Unknown scenario: ${scenario}`)
  }
} catch (e) {
  const error = e as Error & { code?: string }
  print({
    ok: false,
    errorName: error.name,
    errorCode: error.code,
    classification: classifyRefreshFailure(e),
    message: error.message,
    orgHintCalls,
  })
}
