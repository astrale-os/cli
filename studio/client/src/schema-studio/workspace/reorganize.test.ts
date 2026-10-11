import type { LayoutState } from '@shared/contracts/workspace'

import { expect, test } from 'bun:test'

import type { WorkspaceDomainProjection } from './projection'

import { reorganizeSettled } from './reorganize'

function domain(id: string, positions: LayoutState['positions']): WorkspaceDomainProjection {
  return {
    input: { summary: { id }, layout: { positions } },
  } as unknown as WorkspaceDomainProjection
}

test('the fit waits only on the cleared domains still holding a layout', () => {
  const placed = { 'class.Issue': { x: 10, y: 20 } }
  expect(
    reorganizeSettled([domain('issues', placed), domain('services', {})], ['issues', 'services']),
  ).toBe(false)
  expect(
    reorganizeSettled([domain('issues', {}), domain('services', {})], ['issues', 'services']),
  ).toBe(true)
  // added mid-flight with a layout of its own: nothing will ever empty it, so it is not awaited
  expect(reorganizeSettled([domain('issues', {}), domain('shell', placed)], ['issues'])).toBe(true)
  expect(reorganizeSettled([], ['issues'])).toBe(true)
})
