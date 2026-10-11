import { NodeUnavailableError, ResponseError, SessionError } from '@astrale-os/sdk/client'
import { Path } from '@astrale-os/sdk/graph/path'
import { describe, expect, test } from 'bun:test'
import { stripVTControlCharacters } from 'node:util'

import { formatKernelError } from '../errors'
import { functionInputIssues, queryInputRepair } from '../reasons'
import { transportFailure } from './failure-fixtures'

const INVOCATION = { source: 'https://kernel.test', id: 'errors' } as ConstructorParameters<
  typeof ResponseError
>[2]
const RECOVERY = { operation: 'operation-1', retry: 'astrale domain install --operation op-1' }

type ResponseArguments = ConstructorParameters<typeof ResponseError>

function refusal(code: number, reason?: { code: string; details: Record<string, unknown> }) {
  return new ResponseError(
    code as ResponseArguments[0],
    'Refused by the Kernel.',
    INVOCATION,
    reason as ResponseArguments[3],
  )
}

/** The one JSON document a machine-mode failure writes on stderr, and everything written. */
async function machine(
  error: unknown,
  options: Parameters<typeof formatKernelError>[4] & { url?: string; debug?: boolean } = {},
) {
  const writes: string[] = []
  const original = process.stderr.write
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
    return true
  }) as typeof process.stderr.write
  try {
    await formatKernelError(error, true, options.url, options.debug, options)
  } finally {
    process.stderr.write = original
  }
  return { json: JSON.parse(writes[0]!) as Record<string, unknown>, text: writes.join('') }
}

/** What an interactive failure prints, without styling. */
async function human(error: unknown): Promise<string> {
  const lines: string[] = []
  const originalError = console.error
  const originalLog = console.log
  console.error = console.log = (...values: unknown[]) => void lines.push(values.join(' '))
  try {
    await formatKernelError(error, false)
  } finally {
    console.error = originalError
    console.log = originalLog
  }
  return stripVTControlCharacters(lines.join('\n'))
}

describe('transport failures', () => {
  /** @evidence TEST-CLI-CONNECTION-MAPS-TYPED-TRANSPORT */
  test('name the phase and typed context, never the native cause', async () => {
    const acquisition = Object.assign(
      transportFailure('Release discovery failed.', 'connect', {
        kind: 'acquisition',
        resource: 'release',
      }),
      { cause: new Error('connect ECONNREFUSED private') },
    )
    const { json, text } = await machine(acquisition, {
      url: 'https://kernel.test',
      recovery: RECOVERY,
    })
    expect(json).toEqual({
      error: 'CONNECTION_ERROR',
      message: 'Release discovery failed.',
      phase: 'connect',
      transport: { kind: 'acquisition', resource: 'release' },
      url: 'https://kernel.test',
    })
    expect(text).not.toContain('private')
  })

  test('offer the operation retry only when an invocation may have been delivered', async () => {
    const unknown = transportFailure('Timed out.', 'timeout', {
      kind: 'invocation',
      delivery: 'unknown',
    })
    expect((await machine(unknown, { recovery: RECOVERY })).json).toMatchObject({
      error: 'TIMEOUT',
      transport: { kind: 'invocation', delivery: 'unknown' },
      ...RECOVERY,
    })
    const notSent = transportFailure('Send failed.', 'send', {
      kind: 'invocation',
      delivery: 'not-sent',
    })
    expect((await machine(notSent, { recovery: RECOVERY })).json).not.toHaveProperty('operation')
  })
})

describe('Kernel refusals', () => {
  /** @evidence TEST-CLI-CONNECTION-PRESERVES-PUBLIC-SEMANTIC-REASON */
  test('keep the code and reason, adding only a recovery hint', async () => {
    const removal = {
      code: 'DATA_MIGRATION_REQUIRED',
      details: { requirements: [{ operation: 'remove-facts', reason: 'destructive-change' }] },
    }
    expect((await machine(refusal(4001, removal), { fields: { domain: 'x' } })).json).toEqual({
      domain: 'x',
      error: 'RESPONSE_ERROR',
      code: 4001,
      message: 'Refused by the Kernel.',
      reason: removal,
      hint: 'Delete this data explicitly, then retry. No data was deleted.',
    })
    expect((await machine(refusal(2002))).json).toMatchObject({
      code: 2002,
      hint: expect.stringContaining('astrale auth login'),
    })
    const upgrade = {
      code: 'SCHEMA_UPGRADE_INCOMPATIBLE',
      details: { origin: 'grc.example', issue: 'in-flight-limit', inFlight: 8 },
    }
    expect((await machine(refusal(5001, upgrade))).json).toMatchObject({
      reason: upgrade,
      hint: expect.stringContaining('--revoke-previous'),
    })
    const privateSource = { code: 'SCHEMA_DOMAIN_ADDRESS_NOT_PUBLIC', details: {} }
    expect((await machine(refusal(1003, privateSource))).json).toMatchObject({
      message: 'Expose the Domain through a public HTTPS URL or public tunnel, then retry.',
    })
  })

  /** @evidence TEST-CLI-CONNECTION-PRESENTS-BOUNDED-REPAIRS */
  test('print the issues, repairs and issuers a human can act on', async () => {
    const input = await human(
      refusal(1003, {
        code: 'FUNCTION_INPUT_INVALID',
        details: {
          issues: [{ code: 'INVALID_FORMAT', path: '/customer/email', message: 'Not an email.' }],
        },
      }),
    )
    expect(input).toContain('/customer/email: Not an email. (INVALID_FORMAT)')
    expect(input).not.toContain('astrale introspect')

    const query = await human(
      refusal(1003, {
        code: 'QUERY_INPUT_INVALID',
        details: { phase: 'plan', issue: 'QUERY_DEFINITION_NOT_EDGE', path: '/steps/0/via/0' },
      }),
    )
    expect(query).toContain('/steps/0/via/0  QUERY_DEFINITION_NOT_EDGE')

    const issuer = await human(
      refusal(5001, {
        code: 'SCHEMA_UPGRADE_INCOMPATIBLE',
        details: {
          origin: 'grc.example',
          issue: 'issuer-changed',
          installedIssuer: 'https://old.example',
          replacementIssuer: 'https://new.example',
        },
      }),
    )
    expect(issuer).toContain('installed issuer: https://old.example')
    expect(issuer).toContain('replacement issuer: https://new.example')
    expect(issuer).toContain('--allow-issuer-change=grc.example')
  })

  /** @evidence TEST-CLI-CONNECTION-ADMITS-BOUNDED-REASONS */
  test('admit only bounded, well-formed public reason details', () => {
    expect(
      functionInputIssues({
        code: 'FUNCTION_INPUT_INVALID',
        details: {
          issues: [
            { code: 'INVALID_FORMAT', path: '/safe', message: 'Safe message.' },
            { code: 'INVALID_FORMAT', path: 'not-a-pointer', message: 'Unsafe path.' },
            { code: 'INVALID_FORMAT', path: '/unsafe', message: 'Unsafe\nmessage.' },
          ],
        },
      }),
    ).toEqual([{ code: 'INVALID_FORMAT', path: '/safe', message: 'Safe message.' }])
    expect(
      queryInputRepair({
        code: 'QUERY_INPUT_INVALID',
        details: { phase: 'limit', limit: 'steps', maximum: 4, actual: 5 },
      }),
    ).toEqual({ phase: 'limit', limit: 'steps', maximum: 4, actual: 5 })
    expect(
      queryInputRepair({
        code: 'QUERY_INPUT_INVALID',
        details: { phase: 'plan', issue: 'QUERY_DEFINITION_NOT_EDGE', provider: 'private' },
      }),
    ).toBeUndefined()
  })
})

describe('client and unknown failures', () => {
  test('map SDK error identities to stable CLI codes', async () => {
    const pathError = (() => {
      try {
        Path.parse('not-a-path')
      } catch (error) {
        return error
      }
    })()
    expect((await machine(pathError)).json).toMatchObject({ error: 'PATH_INVALID' })
    expect(
      (await machine(new SessionError('Session timed out.', { failure: 'timeout' }))).json,
    ).toEqual({ error: 'TIMEOUT', message: 'Session timed out.' })
    // Missing and authorization-masked reads stay indistinguishable.
    const unavailable = new NodeUnavailableError(Path.parse('/:example.test:core.root'))
    expect((await machine(unavailable)).json).toMatchObject({
      error: 'NODE_UNAVAILABLE',
      hint: expect.stringContaining('-i/--as'),
    })
  })

  /** @evidence TEST-CLI-CONNECTION-FAILURE-SAFETY */
  test('never print a native failure, except its children under --debug', async () => {
    const failure = new AggregateError([new Error('first private')], 'private provider detail')
    const ordinary = await machine(failure)
    expect(ordinary.json).toEqual({
      error: 'UNEXPECTED_ERROR',
      message: 'The CLI encountered an unexpected internal failure.',
    })
    expect(ordinary.text).not.toContain('private')
    expect((await machine(failure, { debug: true })).text).toContain(
      'aggregate: Error: first private',
    )
  })
})
