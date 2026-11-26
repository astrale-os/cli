import { expect, test } from 'bun:test'

import {
  admitRunTarget,
  memberCallable,
  membersQuery,
  schedulesQuery,
} from '../../../src/commands/studio-schedules'
import { decodeMembers, decodeSchedulePage, decodeScheduleStatus } from './schedules'

const KERNEL = 'kernel.astrale.ai'

test('the Schedules of a Domain are read over its members and their schedule_of Edges', () => {
  expect(schedulesQuery('jobs.example.test')).toMatchObject({
    source: { terms: [{ kind: 'path', path: '/:jobs.example.test' }] },
    steps: [
      { op: 'expand', via: [{ origin: KERNEL, name: 'of_domain' }], direction: 'incoming' },
      { op: 'expand', via: [{ origin: KERNEL, name: 'schedule_of' }], direction: 'incoming' },
    ],
    select: { kind: 'edges', projection: { source: 'value', target: 'reference' } },
  })
  expect(membersQuery(['f1', 'f2'])).toMatchObject({
    source: { terms: [{ path: '@f1' }, { path: '@f2' }] },
    steps: [{ via: [{ name: 'of_domain' }], direction: 'outgoing' }],
    select: { projection: { edge: 'value' } },
  })
})

test('a page keeps each Schedule with its Function and input, and its cursor', () => {
  const schedule = (id: string, props: Record<string, unknown>) => ({
    edge: { kind: 'reference', value: { id: `edge-${id}` } },
    source: { kind: 'value', value: { id, class: `${KERNEL}:class.Schedule`, props } },
    target: { kind: 'reference', value: { id: 'fn-digest', class: `${KERNEL}:class.Function` } },
  })
  expect(
    decodeSchedulePage({
      kind: 'edges',
      edges: [
        schedule('s1', {
          [`${KERNEL}:class.Schedule.property.name`]: 'default',
          [`${KERNEL}:class.Schedule.property.input`]: { audience: 'team' },
        }),
        schedule('s2', { [`${KERNEL}:class.Schedule.property.name`]: 'nightly' }),
        schedule('broken', {}),
      ],
      page: { next: 'cursor-2' },
    }),
  ).toEqual({
    schedules: [
      { id: 's1', name: 'default', function: 'fn-digest', input: { audience: 'team' } },
      { id: 's2', name: 'nightly', function: 'fn-digest', input: {} },
    ],
    next: 'cursor-2',
  })
  expect(decodeSchedulePage({ kind: 'nodes', nodes: [] })).toBeUndefined()
})

test('a member names the callable a Schedule starts and the Path that calls it', () => {
  const members = decodeMembers({
    kind: 'edges',
    edges: [
      {
        edge: {
          kind: 'value',
          value: { props: { [`${KERNEL}:class.of_domain.property.member`]: 'function.digest' } },
        },
        source: { kind: 'reference', value: { id: 'fn-digest' } },
        target: { kind: 'reference', value: { id: 'domain' } },
      },
    ],
  })
  expect(members).toEqual(new Map([['fn-digest', 'function.digest']]))
  expect(memberCallable('jobs.example.test', 'function.digest')).toEqual({
    callable: 'digest',
    call: '/:jobs.example.test:function.digest',
  })
  expect(memberCallable('jobs.example.test', 'class.Ledger.method.sweep')).toEqual({
    callable: 'Ledger.sweep',
    call: '/:jobs.example.test:class.Ledger:sweep',
  })
  expect(memberCallable('jobs.example.test', 'view.home')).toBeUndefined()
})

test('the status keeps what Studio shows and refuses an answer without its state', () => {
  expect(
    decodeScheduleStatus({
      id: 's1',
      function: 'fn-digest',
      name: 'default',
      declared: true,
      cron: '0 7 * * 1-5',
      calendar: { minute: [0], hour: [7], weekday: [1, 2, 3, 4, 5] },
      timezone: 'Europe/Paris',
      overlap: 'skip',
      state: 'paused',
      cursor: '2026-11-26T06:00:00.000Z',
      next: '2026-11-27T06:00:00.000Z',
      pausedAt: '2026-11-26T08:00:00.000Z',
      lastExecution: 'exec-1',
      missed: 1,
      skipped: 0,
      refused: 0,
    }),
  ).toEqual({
    declared: true,
    cron: '0 7 * * 1-5',
    timezone: 'Europe/Paris',
    overlap: 'skip',
    state: 'paused',
    cursor: '2026-11-26T06:00:00.000Z',
    next: '2026-11-27T06:00:00.000Z',
    pausedAt: '2026-11-26T08:00:00.000Z',
    lastExecution: 'exec-1',
    missed: 1,
    skipped: 0,
    refused: 0,
  })
  expect(
    decodeScheduleStatus({ cron: '* * * * *', timezone: 'UTC', state: 'gone' }),
  ).toBeUndefined()
})

test('run now calls only a Function or a static Method of a Domain', () => {
  expect(admitRunTarget('/:jobs.example.test:function.digest')).toBe(
    '/:jobs.example.test:function.digest',
  )
  expect(admitRunTarget('/:jobs.example.test:class.Ledger:sweep')).toBe(
    '/:jobs.example.test:class.Ledger:sweep',
  )
  for (const refused of [
    '@s1::kernel.astrale.ai:class.Schedule.method.delete',
    '/:jobs.example.test:class.Ledger',
    'not a path',
    42,
  ]) {
    expect(admitRunTarget(refused)).toBeUndefined()
  }
})
