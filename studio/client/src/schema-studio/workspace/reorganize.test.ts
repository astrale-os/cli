import type { LayoutState } from '@shared/types'

import { expect, test } from 'bun:test'

import type { WorkspaceDomainProjection } from './projection'

import { reorganizeSettled } from './reorganize'

function domain(id: string, positions: LayoutState['positions']): WorkspaceDomainProjection {
  return {
    input: { summary: { id }, layout: { positions } },
  } as unknown as WorkspaceDomainProjection
}

test('holds the fit until every cleared domain has dropped its layout', () => {
  const domains = [domain('issues', { 'class.Issue': { x: 10, y: 20 } }), domain('services', {})]
  expect(reorganizeSettled(domains, ['issues', 'services'])).toBe(false)
})

test('frames the canvas once the ELK re-layout has landed everywhere', () => {
  const domains = [domain('issues', {}), domain('services', {})]
  expect(reorganizeSettled(domains, ['issues', 'services'])).toBe(true)
})

test('never waits on a domain the reorganize did not clear', () => {
  // Added to the workspace mid-flight, carrying a layout of its own — waiting on it would
  // strand the fit, since nothing is going to empty a layout this reorganize never touched.
  const domains = [domain('issues', {}), domain('shell', { 'class.Session': { x: 0, y: 0 } })]
  expect(reorganizeSettled(domains, ['issues'])).toBe(true)
})

test('frames a workspace whose cleared domains have all left it', () => {
  expect(reorganizeSettled([], ['issues'])).toBe(true)
})
