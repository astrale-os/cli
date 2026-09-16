import { describe, expect, test } from 'bun:test'

import { bundle, edgeClass, nodeClass } from './__tests__/fixture'
import { buildModuleTree, folderModules, moduleOfClass } from './modules'

describe('schema modules', () => {
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
  })

  test('builds a class-only tree with stable selection identity', () => {
    const tree = buildModuleTree(fixture)
    expect(tree.children.map((child) => child.path)).toEqual(['identity', 'space'])
    expect(
      tree.children[1]?.members.map((member) => [member.kind, member.selectId, member.ref]),
    ).toEqual([
      ['class', 'class.Space', 'class.Space'],
      ['edge', 'class.owns', 'edge.owns'],
    ])
  })

  test('shows the title-cased module name for the conventional module layout', () => {
    const conventional = bundle({
      Invoice: nodeClass('Invoice'),
      PaymentSchedule: nodeClass('PaymentSchedule'),
    })
    conventional.overlay.sourceSpans = {
      'class.Invoice': {
        file: 'schema/modules/bill/classes/invoice.ts',
        startLine: 1,
        endLine: 4,
      },
      'class.PaymentSchedule': {
        file: 'schema/modules/payment-schedule/classes/payment-schedule.ts',
        startLine: 1,
        endLine: 4,
      },
    }

    expect(folderModules(conventional).map(({ path, label }) => ({ path, label }))).toEqual([
      { path: 'modules/bill', label: 'Bill' },
      { path: 'modules/payment-schedule', label: 'Payment Schedule' },
    ])
  })

  test('puts all declarations directly in their module, then unowned declarations at the root', () => {
    const value = bundle({ Invoice: nodeClass('Invoice'), Resource: nodeClass('Resource') })
    value.ir!.policies = { mayPay: {}, globalAccess: {} }
    value.ir!.functions.pay = { name: 'pay', input: {}, output: { mode: 'value', schema: {} } }
    value.ir!.views.billing = { name: 'billing', target: { kind: 'domain' } }
    for (const [ref, file] of Object.entries({
      'class.Invoice': 'schema/modules/billing/classes/invoice.ts',
      'policy.mayPay': 'schema/modules/billing/policies/nested/may-pay.ts',
      'function.pay': 'schema/modules/billing/functions/pay.ts',
      'view.billing': 'schema/modules/billing/views/billing.ts',
      'class.Resource': 'schema/classes/resource.ts',
      'policy.globalAccess': 'schema/policies/global.ts',
    }))
      value.overlay.sourceSpans[ref] = { file, startLine: 1, endLine: 2 }
    const tree = buildModuleTree(value)
    expect(tree.children.map((node) => node.name)).toEqual(['Billing'])
    expect(tree.children[0]!.children).toEqual([])
    expect(tree.children[0]!.members.map((member) => member.ref).sort()).toEqual([
      'class.Invoice',
      'function.pay',
      'policy.mayPay',
      'view.billing',
    ])
    expect(tree.children[0]!.members.find((member) => member.kind === 'policy')?.selectId).toBe(
      'policy.local.example.dev:policy.mayPay',
    )
    expect(tree.members.map((member) => member.ref).sort()).toEqual([
      'class.Resource',
      'policy.globalAccess',
    ])
    expect(
      folderModules(value).find((module) => module.path === 'modules/billing')?.classes,
    ).toEqual(['Invoice'])
    expect(moduleOfClass(value, 'Invoice')).toBe('modules/billing')
  })

  test('keeps the full path when the module layout is not recognized', () => {
    expect(folderModules(fixture).map(({ path, label }) => ({ path, label }))).toEqual([
      { path: 'identity', label: 'identity' },
      { path: 'space', label: 'space' },
    ])
  })
})
