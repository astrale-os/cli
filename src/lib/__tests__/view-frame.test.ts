import type { ShellAdapter, WindowConfig } from '@astrale-os/shell'

import { describe, expect, test } from 'bun:test'

import { accessibleIframeAdapter, viewTitle } from '../../../viewer/frame'

describe('viewer iframe accessibility', () => {
  test('names each iframe from the exact selected View key before mounting it', () => {
    const attributes = new Map<string, string>()
    const element = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    } as unknown as HTMLElement
    const base = {
      mount: () => ({ handle: { element, port: null, origin: '' }, dispose() {} }),
    } as unknown as ShellAdapter
    const config = {
      functionId: 'logistics.astrale.ai:view.operations',
    } as WindowConfig

    accessibleIframeAdapter(base).mount(config)

    const expected = 'Astrale View /:logistics.astrale.ai:view.operations'
    expect(viewTitle(config.functionId)).toBe(expected)
    expect(attributes.get('title')).toBe(expected)
    expect(attributes.get('aria-label')).toBe(expected)
  })
})
