import { expect, test } from 'bun:test'

import { cliFailure, commandRefusal, registryRefusal, statusOfRefusal } from './failure'
import { markedMessages, MarkedLineReader, type MarkedLine } from './marks'
import { baselineOf, carriersOf, relationOf } from './relation'
import { publication, revision } from './test-fixtures'

const at = '2026-11-26T12:00:00.000Z'
const A = revision('a')
const B = revision('b')
const C = revision('c')

test('a CLI refusal maps to the status of the remote fact it denies', () => {
  expect(statusOfRefusal({ code: 'IDP_SESSION_MISSING', message: '' })).toBe('signed-out')
  expect(statusOfRefusal({ code: 'AUTH_ERROR', message: '' })).toBe('signed-out')
  expect(statusOfRefusal({ code: 'CONNECTION_ERROR', message: '' })).toBe('offline')
  expect(statusOfRefusal({ code: 'REGISTRY_DOMAIN_NOT_FOUND', message: '' })).toBe('not-found')
  expect(statusOfRefusal({ code: 'PUBLICATION_NOT_FOUND', message: '' })).toBe('not-found')
  expect(statusOfRefusal({ code: 'REGISTRY_FORBIDDEN', message: '' })).toBe('refused')
  expect(statusOfRefusal({ code: 'USAGE_ERROR', message: '' })).toBe('failed')
  // Nothing answered, or the registry asks for a rerun: offline. An unreadable answer: failed.
  const unavailable = (details: Record<string, unknown>) =>
    statusOfRefusal({ code: 'REGISTRY_UNAVAILABLE', message: '', details })
  expect(unavailable({ reason: 'transport' })).toBe('offline')
  expect(unavailable({ reason: 'response-invalid', retryable: true })).toBe('offline')
  expect(unavailable({ reason: 'response-invalid' })).toBe('failed')
})

test('only the machine error documents the CLI composed are read, never raw diagnostics', () => {
  expect(
    registryRefusal(
      '{"error":{"code":"REGISTRY_FORBIDDEN","message":"No.","details":{"origin":"x"}}}',
    ),
  ).toEqual({ code: 'REGISTRY_FORBIDDEN', message: 'No.', details: { origin: 'x' } })
  expect(registryRefusal('{"format":"astrale.registry-index"}')).toBeUndefined()
  expect(
    commandRefusal(
      'Bun v1 crashed\n{"error":"NO_IDENTITY","message":"No identity.","hint":"Run astrale setup."}\n',
    ),
  ).toEqual({ code: 'NO_IDENTITY', message: 'No identity. Run astrale setup.' })

  const base = { exitCode: 1, stdout: '', stderr: 'TypeError: secret stack', timedOut: false }
  expect(cliFailure(base, 'domain versions x', at)).toEqual({
    status: 'failed',
    message: 'astrale domain versions x answered nothing this Studio can read (exit 1).',
    readAt: at,
  })
  expect(cliFailure({ ...base, timedOut: true }, 'status', at).status).toBe('offline')
  expect(cliFailure({ ...base, exitCode: -1, spawnError: 'ENOENT' }, 'status', at)).toEqual({
    status: 'failed',
    message: 'astrale status could not start: ENOENT',
    readAt: at,
  })
  expect(
    cliFailure(
      { ...base, stdout: '{"error":{"code":"REGISTRY_DOMAIN_NOT_FOUND","message":"Absent."}}' },
      'x',
      at,
    ),
  ).toEqual({
    status: 'not-found',
    code: 'REGISTRY_DOMAIN_NOT_FOUND',
    message: 'Absent.',
    readAt: at,
  })
})

test('marked platform lines stream as they complete; unmarked output is only counted', () => {
  const lines: MarkedLine[] = []
  const reader = new MarkedLineReader((line) => lines.push(line))
  reader.push('\x1b[2m›\x1b[0m step one\nbundler noise\n\x1b[33m!\x1b[0m care')
  expect(lines).toEqual([{ tone: 'step', line: 'step one', continues: false }])
  reader.push('ful\n  continued\n\x1b[31m✗\x1b[0m refused\n')
  reader.push('  because\nlast')
  reader.end()
  expect(lines).toEqual([
    { tone: 'step', line: 'step one', continues: false },
    { tone: 'warning', line: 'careful', continues: false },
    { tone: 'warning', line: '  continued', continues: true },
    { tone: 'refusal', line: 'refused', continues: false },
    { tone: 'refusal', line: '  because', continues: true },
  ])
  expect(reader.unmarked).toBe(2)
  expect(markedMessages('› a\n  b\n! c\n')).toEqual([
    { tone: 'step', message: 'a\n  b' },
    { tone: 'warning', message: 'c' },
  ])
})

test('the baseline is the highest stable version up to the declared one, yanked included', () => {
  const index = {
    origin: 'x.test',
    publications: [
      publication('2.0.0', C),
      publication('1.2.0-beta.1', B),
      publication('1.1.0', B, { yanked: true }),
      publication('1.0.0', A),
    ],
  }
  expect(baselineOf(index, '1.2.0')?.version).toBe('1.1.0')
  expect(baselineOf(index, '1.0.0')?.version).toBe('1.0.0')
  expect(baselineOf(index, '1.0.0-rc.1')).toBeUndefined()
  expect(carriersOf(index, B)).toEqual(['1.2.0-beta.1', '1.1.0'])
  expect(carriersOf(index, null)).toEqual([])
})

test('the relation to the last Publication names what is known and why the rest is not', () => {
  const ok = (publications: ReturnType<typeof publication>[]) =>
    ({ status: 'ok', value: { origin: 'x.test', publications }, readAt: at }) as const
  const published = ok([publication('1.1.0', B), publication('1.0.0', A)])
  expect(relationOf({ declared: '1.2.0', revision: B }, published)).toEqual({
    kind: 'same-revision',
    latest: '1.1.0',
  })
  expect(relationOf({ declared: '1.2.0', revision: C }, published)).toEqual({
    kind: 'ahead',
    latest: '1.1.0',
  })
  expect(relationOf({ declared: '1.0.0', revision: C }, published)).toEqual({
    kind: 'version-taken',
    latest: '1.1.0',
  })
  expect(relationOf({ declared: '0.9.0', revision: C }, published)).toEqual({
    kind: 'behind',
    latest: '1.1.0',
  })
  expect(relationOf({ declared: '1.2.0', revision: null }, published).kind).toBe('undetermined')
  expect(relationOf({ declared: '1.2.0', revision: C }, ok([]))).toEqual({
    kind: 'never-published',
    registered: true,
  })
  expect(
    relationOf(
      { declared: '1.2.0', revision: C },
      { status: 'not-found', message: 'Absent.', readAt: at },
    ),
  ).toEqual({ kind: 'never-published', registered: false })
  expect(
    relationOf(
      { declared: '1.2.0', revision: C },
      { status: 'offline', message: 'Down.', readAt: at },
    ),
  ).toEqual({ kind: 'undetermined', reason: 'The registry index could not be read: Down.' })
})
