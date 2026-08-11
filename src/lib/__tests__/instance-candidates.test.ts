import { describe, expect, test } from 'bun:test'

import type { OwnedInstanceInfo } from '../admin-instance'
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
  region: 'eu',
}

describe('collectInstanceCandidates', () => {
  test('bookmark and managed at the same URL collapse into one candidate', () => {
    const candidates = collectInstanceCandidates('demo', store, [managedDemo])
    expect(candidates).toEqual([
      {
        source: 'bookmark',
        key: 'demo',
        url: 'https://demo.eu.astrale.ai/api',
        entry: store.instances.demo,
      },
    ])
  })

  test('bookmark and managed at different URLs are both candidates', () => {
    const conflicting: OwnedInstanceInfo = {
      ...managedDemo,
      url: 'https://demo.us.astrale.ai',
    }
    const candidates = collectInstanceCandidates('demo', store, [conflicting])
    expect(
      candidates.map((candidate) => ({
        source: candidate.source,
        key: candidate.key,
        url: candidate.url,
        id: candidate.source === 'managed' ? candidate.info.id : undefined,
      })),
    ).toEqual([
      {
        source: 'bookmark',
        key: 'demo',
        url: 'https://demo.eu.astrale.ai/api',
        id: undefined,
      },
      {
        source: 'managed',
        key: 'demo',
        url: 'https://demo.us.astrale.ai/api',
        id: 'demo',
      },
    ])
  })

  test('multiple managed instances with the same slug are all candidates', () => {
    const a: OwnedInstanceInfo = {
      id: 'x1',
      slug: 'twin',
      url: 'https://twin.eu.astrale.ai',
      state: 'ready',
    }
    const b: OwnedInstanceInfo = {
      id: 'x2',
      slug: 'twin',
      url: 'https://twin.us.astrale.ai',
      state: 'ready',
    }
    const candidates = collectInstanceCandidates('twin', store, [a, b])
    expect(
      candidates.map((candidate) => ({
        source: candidate.source,
        key: candidate.key,
        id: candidate.source === 'managed' ? candidate.info.id : undefined,
      })),
    ).toEqual([
      { source: 'managed', key: 'twin', id: 'x1' },
      { source: 'managed', key: 'twin', id: 'x2' },
    ])
  })

  test('managed instances with a different slug are ignored', () => {
    const unrelated: OwnedInstanceInfo = {
      id: 'z',
      slug: 'zeta',
      url: 'https://zeta.eu.astrale.ai',
      state: 'ready',
    }
    expect(
      collectInstanceCandidates('demo', store, [unrelated]).map((candidate) => ({
        source: candidate.source,
        key: candidate.key,
      })),
    ).toEqual([{ source: 'bookmark', key: 'demo' }])
  })

  test('bookmark resolution honours slug aliases', () => {
    const candidates = collectInstanceCandidates('oth', store, [])
    expect(
      candidates.map((candidate) => ({
        source: candidate.source,
        key: candidate.key,
        url: candidate.url,
      })),
    ).toEqual([
      {
        source: 'bookmark',
        key: 'other',
        url: 'https://other.example.com/api',
      },
    ])
  })

  test('unknown name yields no candidates', () => {
    expect(collectInstanceCandidates('missing', store, [])).toEqual([])
  })
})

describe('describeInstanceCandidate', () => {
  test('labels carry source and URL', () => {
    const [bookmark] = collectInstanceCandidates('demo', store, [])
    expect(describeInstanceCandidate(bookmark!)).toContain('(bookmark)')
    expect(describeInstanceCandidate(bookmark!)).toContain('https://demo.eu.astrale.ai/api')

    const [managed] = collectInstanceCandidates('twin', store, [
      {
        id: 'x',
        slug: 'twin',
        url: 'https://twin.eu.astrale.ai',
        state: 'ready',
        region: 'eu',
      },
    ])
    expect(describeInstanceCandidate(managed!)).toBe(
      'twin (managed) https://twin.eu.astrale.ai/api — eu',
    )
  })
})
