import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Scenario } from '../../shared/contracts/scenarios'

import { ANYONE, SCENARIO_LIMITS } from '../../shared/contracts/scenarios'
import { decodeScenario, deleteScenario, putScenario, readScenarios } from './scenarios'
import { UnreadableState } from './state-file'
import { writeJson } from './store'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

const domainRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-scenarios-'))
  roots.push(root)
  return root
}

const edge = { from: 'development-service', relation: 'service_owned_by', to: 'kernel-developer' }

const scenario = (id: string, name = 'Who runs a deployment'): Scenario => ({
  id,
  dataset: './tests/datasets/identity-owners.ts',
  name,
  steps: [
    {
      id: 's1',
      as: 'kernel-developer',
      does: 'read',
      on: { node: 'development-current' },
      expect: 'allowed',
    },
    { id: 's2', as: ANYONE, does: 'traverse', on: { edge }, expect: 'refused' },
    {
      id: 's3',
      as: 'release-pipeline',
      does: 'call',
      fn: 'Deployment.promote',
      on: { node: 'development-current' },
      expect: 'refused',
      note: 'only its owner promotes',
    },
    {
      id: 's4',
      as: 'kernel-developer',
      does: 'call',
      fn: 'CloudflareService.deploy',
      expect: 'allowed',
    },
  ],
})

const decoded = (value: unknown) => {
  const result = decodeScenario(value)
  return 'problem' in result ? result.problem : result.value
}

test('a Scenario decodes whole, each step as it is written', () => {
  expect(decoded(scenario('a'))).toEqual(scenario('a'))
  // a read may name an Edge; unknown keys are dropped, names and notes trimmed, an empty note forgotten
  expect(
    decoded({
      ...scenario('a', '  Spaced  '),
      extra: true,
      steps: [
        { id: 'x', as: 'p', does: 'read', on: { edge }, expect: 'allowed', note: '  ', more: 1 },
      ],
    }),
  ).toEqual({
    id: 'a',
    dataset: './tests/datasets/identity-owners.ts',
    name: 'Spaced',
    steps: [{ id: 'x', as: 'p', does: 'read', on: { edge }, expect: 'allowed' }],
  })
})

test('a write that does not decode says what is wrong', () => {
  const one = scenario('a')
  const step = (patch: object) => ({ ...one, steps: [{ ...one.steps[0], ...patch }] })
  expect(decoded(null)).toBe('a Scenario is an object')
  expect(decoded({ ...one, id: 'has space' })).toBe('a Scenario names its id')
  expect(decoded({ ...one, dataset: '' })).toBe('a Scenario names its dataset')
  expect(decoded({ ...one, name: '   ' })).toBe('a Scenario has a name')
  expect(decoded({ ...one, name: 'n'.repeat(SCENARIO_LIMITS.name + 1) })).toBe(
    `a Scenario's name is at most ${SCENARIO_LIMITS.name} characters`,
  )
  expect(decoded({ ...one, steps: {} })).toBe('a Scenario lists its steps')
  expect(decoded({ ...one, steps: Array(SCENARIO_LIMITS.steps + 1).fill(one.steps[0]) })).toBe(
    `a Scenario holds at most ${SCENARIO_LIMITS.steps} steps`,
  )
  expect(decoded(step({ id: '' }))).toBe('step 1 has no id')
  expect(decoded(step({ as: 7 }))).toBe('step 1 names no one acting')
  expect(decoded(step({ expect: 'unknown' }))).toBe('step 1 expects allowed or refused')
  expect(decoded(step({ does: 'write' }))).toBe('step 1 reads, traverses or calls')
  expect(decoded(step({ on: { path: 'x' } }))).toBe(
    'step 1 reads a Node by its path or an Edge by its ends and relationship',
  )
  expect(decoded(step({ does: 'traverse', on: { node: 'x' } }))).toBe(
    'step 1 traverses an Edge by its ends and relationship',
  )
  expect(decoded(step({ does: 'call', on: { node: 'x' } }))).toBe(
    'step 1 calls a function by its handler key',
  )
  expect(decoded(step({ does: 'call', fn: 'F', on: { edge } }))).toBe(
    'step 1 calls on a Node by its path, or on none',
  )
  expect(decoded(step({ note: 3 }))).toBe("step 1's note is not text")
  expect(decoded(step({ note: 'n'.repeat(SCENARIO_LIMITS.note + 1) }))).toBe(
    `step 1's note is longer than ${SCENARIO_LIMITS.note} characters`,
  )
  expect(decoded({ ...one, steps: [one.steps[0], one.steps[0]] })).toBe('step 2 repeats the id s1')
})

const store = (scenarios: Scenario[], revisions: Record<string, number>) => ({
  scenarios,
  revisions,
})

test('a put adds a Scenario or replaces the one with its id, in place, counting revisions', () => {
  const root = domainRoot()
  expect(readScenarios(root)).toEqual(store([], {}))
  putScenario(root, scenario('a'), 0)
  putScenario(root, scenario('b', 'Second'), 0)
  const renamed = { ...scenario('a', 'Renamed'), steps: [] }
  expect(putScenario(root, renamed, 1)).toEqual({
    value: store([renamed, scenario('b', 'Second')], { a: 2, b: 1 }),
  })
  expect(existsSync(join(root, '.domain-studio', 'scenarios.json'))).toBe(true)
  expect(readScenarios(root)).toEqual(store([renamed, scenario('b', 'Second')], { a: 2, b: 1 }))
})

test('a write made from an older revision is refused and changes nothing', () => {
  const root = domainRoot()
  putScenario(root, scenario('a'), 0)
  putScenario(root, scenario('a', 'Second tab'), 1)
  // the first tab, still at revision 1, renames it: refused rather than undo the second tab
  expect(putScenario(root, scenario('a', 'First tab'), 1)).toEqual({
    stale: 'Scenario a changed elsewhere (revision 2, this was made from 1).',
  })
  expect(deleteScenario(root, 'a', 1)).toEqual({
    stale: 'Scenario a changed elsewhere (revision 2, this was made from 1).',
  })
  // a new Scenario whose id another tab took meanwhile
  expect(putScenario(root, scenario('a', 'Also new'), 0)).toEqual({
    stale: 'Scenario a changed elsewhere (revision 2, this was made from 0).',
  })
  // an edit to a Scenario another tab deleted
  deleteScenario(root, 'a', 2)
  expect(putScenario(root, scenario('a', 'Edited'), 2)).toEqual({
    stale: 'Scenario a is no longer there: it was deleted elsewhere after this was made.',
  })
  expect(readScenarios(root)).toEqual(store([], {}))
})

test('a Domain keeps a bounded number of Scenarios; replacing one is always allowed', () => {
  const root = domainRoot()
  const full = Array.from({ length: SCENARIO_LIMITS.scenarios }, (_, index) =>
    scenario(`s${index}`),
  )
  writeJson(root, 'scenarios.json', { scenarios: full })
  expect(putScenario(root, scenario('one-more'), 0)).toEqual({
    problem: `a Domain keeps at most ${SCENARIO_LIMITS.scenarios} Scenarios`,
  })
  // a Scenario written before revisions were kept is at revision 0
  expect('value' in putScenario(root, scenario('s0', 'Replaced'), 0)).toBe(true)
})

test('a delete removes one Scenario; one already gone changes nothing', () => {
  const root = domainRoot()
  putScenario(root, scenario('a'), 0)
  putScenario(root, scenario('b'), 0)
  expect(deleteScenario(root, 'a', 1)).toEqual({ value: store([scenario('b')], { b: 1 }) })
  expect(deleteScenario(root, 'a', 1)).toEqual({
    value: store([scenario('b')], { b: 1 }),
    unchanged: true,
  })
})

test('a file not read whole is said as such, and no write goes over it', () => {
  const root = domainRoot()
  const path = join(root, '.domain-studio', 'scenarios.json')
  const unreadable = (reason: string) => {
    expect(() => readScenarios(root)).toThrow(new UnreadableState(path, reason))
    expect(() => putScenario(root, scenario('c'), 0)).toThrow(UnreadableState)
    expect(() => deleteScenario(root, 'a', 0)).toThrow(UnreadableState)
  }
  // one entry this Studio does not decode — a newer Studio's, a hand edit
  const raw = { scenarios: [scenario('a'), { id: 'broken' }, scenario('b')] }
  writeJson(root, 'scenarios.json', raw)
  unreadable('Scenario 2 (broken): a Scenario names its dataset')
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(raw)

  writeJson(root, 'scenarios.json', { scenarios: [scenario('a'), scenario('a', 'Duplicate')] })
  unreadable('Scenario 2 (a) repeats the id of another')

  // a merge conflict left in it
  const conflict = `<<<<<<< HEAD\n{"scenarios": []}\n=======\n{"scenarios": [1]}\n>>>>>>> theirs\n`
  writeFileSync(path, conflict)
  unreadable('it holds an unresolved merge conflict')
  expect(readFileSync(path, 'utf8')).toBe(conflict)

  writeFileSync(path, '{"scenarios": [')
  expect(() => readScenarios(root)).toThrow(/is not JSON/)
  writeJson(root, 'scenarios.json', ['not', 'a', 'store'])
  unreadable('it holds no object')
})

test('a key this Studio does not know, on a Scenario or a step, is kept through a rewrite', () => {
  const root = domainRoot()
  const a = scenario('a')
  const steps = a.steps.map((step, index) => (index === 0 ? { ...step, weight: 3 } : step))
  writeJson(root, 'scenarios.json', {
    format: 'next',
    scenarios: [
      { ...a, steps, owner: 'ann' },
      { ...scenario('b'), owner: 'bob' },
    ],
    revisions: { a: 1 },
  })
  putScenario(root, { ...a, name: 'Renamed' }, 1)
  deleteScenario(root, 'b', 0)
  const written = JSON.parse(readFileSync(join(root, '.domain-studio', 'scenarios.json'), 'utf8'))
  expect(written).toEqual({
    scenarios: [{ ...a, name: 'Renamed', steps, owner: 'ann' }],
    revisions: { a: 2 },
    format: 'next',
  })
})
