import { describe, expect, test } from 'bun:test'

import type { InstanceInfo } from '../admin-instance'
import type { InstanceStore } from '../instance'

import { collectInstanceCandidates, describeInstanceCandidate } from '../instance-candidates'

const store: InstanceStore = {
  active: 'demo',
  instances: {
    demo: { url: 'https://demo.eu.astrale.ai/api', kind: 'bookmark' },
    other: { url: 'https://other.example.com/api', kind: 'bookmark', slug: 'oth' },
  },
}

const managedDemo: InstanceInfo = {
  id: 'demo',
  slug: 'demo',
  url: 'https://demo.eu.astrale.ai',
  region: 'eu',
}

describe('collectInstanceCandidates', () => {
  test('bookmark and managed at the same URL collapse into one candidate', () => {
    const candidates = collectInstanceCandidates('demo', store, [managedDemo])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ source: 'bookmark', key: 'demo' })
  })

  test('bookmark and managed at different URLs are both candidates', () => {
    const conflicting: InstanceInfo = { ...managedDemo, url: 'https://demo.us.astrale.ai' }
    const candidates = collectInstanceCandidates('demo', store, [conflicting])
    expect(candidates).toHaveLength(2)
    expect(candidates.map((c) => c.source)).toEqual(['bookmark', 'managed'])
  })

  test('multiple managed instances with the same slug are all candidates', () => {
    const a: InstanceInfo = { id: 'x1', slug: 'twin', url: 'https://twin.eu.astrale.ai' }
    const b: InstanceInfo = { id: 'x2', slug: 'twin', url: 'https://twin.us.astrale.ai' }
    const candidates = collectInstanceCandidates('twin', store, [a, b])
    expect(candidates).toHaveLength(2)
    expect(candidates.every((c) => c.source === 'managed')).toBe(true)
  })

  test('managed instances with a different slug are ignored', () => {
    const unrelated: InstanceInfo = { id: 'z', slug: 'zeta', url: 'https://zeta.eu.astrale.ai' }
    expect(collectInstanceCandidates('demo', store, [unrelated])).toHaveLength(1)
  })

  test('bookmark resolution honours slug aliases', () => {
    const candidates = collectInstanceCandidates('oth', store, [])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ source: 'bookmark', key: 'other' })
  })

  test('unknown name yields no candidates', () => {
    expect(collectInstanceCandidates('missing', store, [])).toHaveLength(0)
  })
})

describe('describeInstanceCandidate', () => {
  test('labels carry source and URL', () => {
    const [bookmark] = collectInstanceCandidates('demo', store, [])
    expect(describeInstanceCandidate(bookmark!)).toContain('(bookmark)')
    expect(describeInstanceCandidate(bookmark!)).toContain('https://demo.eu.astrale.ai/api')

    const [managed] = collectInstanceCandidates('twin', store, [
      { id: 'x', slug: 'twin', url: 'https://twin.eu.astrale.ai', region: 'eu' },
    ])
    expect(describeInstanceCandidate(managed!)).toContain('(managed)')
    expect(describeInstanceCandidate(managed!)).toContain('eu')
  })
})
