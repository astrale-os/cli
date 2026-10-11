import { describe, expect, test } from 'bun:test'

import type { OwnedInstanceInfo } from '../../admin/instance'
import type { InstanceStore } from '../instance'

import { collectInstanceCandidates, describeInstanceCandidate } from '../instance-candidates'

const store: InstanceStore = {
  active: 'demo',
  instances: {
    demo: { url: 'https://demo.eu.astrale.ai/api', kind: 'bookmark' },
    other: { url: 'https://other.example.com/api', kind: 'bookmark', slug: 'oth' },
  },
}

const managedDemo: OwnedInstanceInfo = {
  id: 'demo',
  slug: 'demo',
  url: 'https://demo.eu.astrale.ai',
  state: 'ready',
}

describe('collectInstanceCandidates', () => {
  test('a bookmark and a managed Instance collapse at the same URL, else both are candidates', () => {
    expect(collectInstanceCandidates('demo', store, [managedDemo])).toEqual([
      {
        source: 'bookmark',
        key: 'demo',
        url: 'https://demo.eu.astrale.ai/api',
        entry: store.instances.demo,
      },
    ])
    const elsewhere = { ...managedDemo, url: 'https://demo.us.astrale.ai' }
    expect(
      collectInstanceCandidates('demo', store, [elsewhere]).map(describeInstanceCandidate),
    ).toEqual([
      'demo (bookmark) https://demo.eu.astrale.ai/api',
      'demo (managed) https://demo.us.astrale.ai/api',
    ])
  })

  test('a name matches bookmarks by alias and managed Instances by slug, nothing else', () => {
    const twin = (id: string, region: string): OwnedInstanceInfo => ({
      id,
      slug: 'twin',
      url: `https://twin.${region}.astrale.ai`,
      state: 'ready',
    })
    const managed = [twin('x1', 'eu'), twin('x2', 'us')]
    expect(
      collectInstanceCandidates('twin', store, managed).map(describeInstanceCandidate),
    ).toEqual([
      'twin (managed) https://twin.eu.astrale.ai/api',
      'twin (managed) https://twin.us.astrale.ai/api',
    ])
    expect(collectInstanceCandidates('oth', store, managed).map(describeInstanceCandidate)).toEqual(
      ['other (bookmark) https://other.example.com/api'],
    )
    expect(collectInstanceCandidates('missing', store, managed)).toEqual([])
  })
})
