import type { InstanceInfo } from '@shared/contracts/workspace'

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { activeInstanceWarning, InstanceList } from './instance-switcher'

const owned: InstanceInfo = {
  name: 'mine',
  url: 'https://mine.eu.astrale.ai/api',
  active: false,
  kind: 'bookmark',
  owned: true,
}
const member: InstanceInfo = {
  name: 'team',
  url: 'https://team.eu.astrale.ai/api',
  active: false,
  kind: 'managed',
  owned: false,
  reason: 'Not owner',
}
const local: InstanceInfo = {
  name: 'dev',
  url: 'http://127.0.0.1:7200',
  active: false,
  kind: 'bookmark',
  owned: false,
  reason: 'Not an Admin instance',
}

/** Each listed instance's pick button, by instance name. */
function buttons(html: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const [button] of html.matchAll(/<button[^>]*>.*?<\/button>/g)) {
    const name = /font-medium">([^<]+)</.exec(button)?.[1]
    if (name) found.set(name, button)
  }
  return found
}

test('an instance the user does not own is listed, greyed with its reason, and cannot be picked', () => {
  const html = renderToStaticMarkup(
    <InstanceList instances={[owned, member, local]} switching={null} onPick={() => {}} />,
  )
  const listed = buttons(html)
  expect([...listed.keys()]).toEqual(['mine', 'team', 'dev'])
  expect(listed.get('mine')).not.toContain('disabled=""')
  expect(listed.get('team')).toContain('disabled=""')
  expect(listed.get('team')).toContain('Not owner')
  expect(listed.get('dev')).toContain('disabled=""')
  expect(listed.get('dev')).toContain('Not an Admin instance')
  expect(listed.get('dev')).toContain('Studio works only with instances you own in Admin')
  // No active instance, so nothing to warn about.
  expect(html).not.toContain('role="alert"')
})

test('an active instance the user does not own carries a warning instead of a check', () => {
  const instances = [owned, { ...member, active: true }]
  expect(activeInstanceWarning(instances)).toBe(
    'You are not the owner of team in Admin (Not owner). Its Views cannot be opened in Studio.',
  )
  const html = renderToStaticMarkup(
    <InstanceList instances={instances} switching={null} onPick={() => {}} />,
  )
  expect(html).toContain('role="alert"')
  expect(html).toContain('You are not the owner of team in Admin')
  expect(activeInstanceWarning([{ ...owned, active: true }, member])).toBeNull()
})

test('while the instances load, the list shows a loader instead of "No instances found"', () => {
  const loading = renderToStaticMarkup(
    <InstanceList instances={[]} loading switching={null} onPick={() => {}} />,
  )
  expect(loading).toContain('role="status"')
  expect(loading).toContain('aria-label="Loading instances"')
  expect(loading).toContain('animate-pulse')
  expect(loading).not.toContain('animate-spin')
  expect(loading).not.toContain('No instances found')

  const empty = renderToStaticMarkup(
    <InstanceList instances={[]} switching={null} onPick={() => {}} />,
  )
  expect(empty).toContain('No instances found')
  expect(empty).not.toContain('Loading instances')
})
