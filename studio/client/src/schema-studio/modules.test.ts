import { expect, test } from 'bun:test'

import { bundle, edgeClass, nodeClass } from './__tests__/fixture'
import { folderModules, moduleOfClass, moduleOfMember } from './modules'

const fixture = bundle({
  User: nodeClass('User'),
  Space: nodeClass('Space'),
  owns: edgeClass('owns', [
    { name: 'owner', types: ['User'] },
    { name: 'space', types: ['Space'] },
  ]),
})
fixture.overlay.sourceSpans = {
  'class.User': { file: 'schema/identity/user.ts', startLine: 1, endLine: 4 },
  'class.Space': { file: 'schema/space/space.ts', startLine: 1, endLine: 4 },
  'edge.owns': { file: 'schema/space/owns.ts', startLine: 1, endLine: 4 },
}

test('groups Node and Edge Classes by authored schema folder', () => {
  expect(
    folderModules(fixture).map(({ path, classes, edges }) => ({ path, classes, edges })),
  ).toEqual([
    { path: 'identity', classes: ['User'], edges: [] },
    { path: 'space', classes: ['Space'], edges: ['owns'] },
  ])
  expect(moduleOfClass(fixture, 'Space')).toBe('space')
  // an unrecognised layout keeps the full path as its label
  expect(folderModules(fixture).map(({ label }) => label)).toEqual(['identity', 'space'])
})

test('shows the title-cased module name for the conventional module layout', () => {
  const conventional = bundle({
    Invoice: nodeClass('Invoice'),
    PaymentSchedule: nodeClass('PaymentSchedule'),
  })
  for (const [ref, file] of Object.entries({
    'class.Invoice': 'schema/modules/bill/classes/invoice.ts',
    'class.PaymentSchedule': 'schema/modules/payment-schedule/classes/payment-schedule.ts',
  }))
    conventional.overlay.sourceSpans[ref] = { file, startLine: 1, endLine: 4 }

  expect(folderModules(conventional).map(({ path, label }) => ({ path, label }))).toEqual([
    { path: 'modules/bill', label: 'Bill' },
    { path: 'modules/payment-schedule', label: 'Payment Schedule' },
  ])
})

test('places every declaration in its module folder, and the rest at the root', () => {
  const value = bundle({ Invoice: nodeClass('Invoice'), Resource: nodeClass('Resource') })
  value.ir!.policies = { mayPay: {}, globalAccess: {} }
  value.ir!.functions.pay = { name: 'pay', input: {}, output: { mode: 'value', schema: {} } }
  value.ir!.views.billing = { name: 'billing' }
  for (const [ref, file] of Object.entries({
    'class.Invoice': 'schema/modules/billing/classes/invoice.ts',
    'policy.mayPay': 'schema/modules/billing/policies/nested/may-pay.ts',
    'function.pay': 'schema/modules/billing/functions/pay.ts',
    'view.billing': 'schema/modules/billing/views/billing.ts',
    'class.Resource': 'schema/classes/resource.ts',
    'policy.globalAccess': 'schema/policies/global.ts',
  }))
    value.overlay.sourceSpans[ref] = { file, startLine: 1, endLine: 2 }
  expect(
    (
      [
        ['class', 'Invoice'],
        ['policy', 'mayPay'],
        ['function', 'pay'],
        ['view', 'billing'],
        ['class', 'Resource'],
        ['policy', 'globalAccess'],
      ] as const
    ).map(([kind, name]) => moduleOfMember(value, kind, name)),
  ).toEqual([
    'modules/billing',
    'modules/billing',
    'modules/billing',
    'modules/billing',
    'root',
    'root',
  ])
  expect(folderModules(value).find((module) => module.path === 'modules/billing')?.classes).toEqual(
    ['Invoice'],
  )
  expect(moduleOfClass(value, 'Invoice')).toBe('modules/billing')
})
