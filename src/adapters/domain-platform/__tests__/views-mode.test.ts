import { describe, expect, test } from 'bun:test'

import { effectiveViewsMode, vitePortFor } from '../cloudflare-helpers'

/**
 * Pins the two pure pieces of the views feature. The spawn/health
 * helpers (`runClientBuild`, `tryViteHmr`) drive real processes and are
 * covered by the end-to-end verification, not unit tests.
 */
describe('vitePortFor', () => {
  test('+40000 offset — clear of the worker range', () => {
    expect(vitePortFor(8833)).toBe(48833) // distribution
    expect(vitePortFor(8844)).toBe(48844) // manager-ui
    expect(vitePortFor(8866)).toBe(48866) // onepact-demo
  })

  test('unique whenever worker ports are unique', () => {
    expect(vitePortFor(8833)).not.toBe(vitePortFor(8844))
  })
})

describe('effectiveViewsMode — opts ?? config ?? "built"', () => {
  test('default (nothing declared) → built', () => {
    expect(effectiveViewsMode(undefined, undefined)).toBe('built')
  })

  test('config alone is honoured', () => {
    expect(effectiveViewsMode(undefined, 'hmr')).toBe('hmr')
    expect(effectiveViewsMode(undefined, 'built')).toBe('built')
  })

  test('--views override beats config', () => {
    expect(effectiveViewsMode('built', 'hmr')).toBe('built')
    expect(effectiveViewsMode('hmr', 'built')).toBe('hmr')
  })
})
