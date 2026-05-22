import { describe, expect, test } from 'bun:test'

import { BINDING_KEY, extractDomainSlug, findFirstRemoteUrl } from '../spec'

describe('spec — extractDomainSlug', () => {
  test('returns props.origin from the Domain node', () => {
    const nodes = [
      { class: '/:kernel.astrale.ai:class.Folder', path: '/x/core' },
      {
        class: '/:kernel.astrale.ai:class.Domain',
        path: '/dist.localhost',
        props: { origin: 'dist.localhost' },
      },
    ]
    expect(extractDomainSlug(nodes)).toBe('dist.localhost')
  })

  test('falls back to path minus leading slash when origin absent', () => {
    const nodes = [{ class: '/:kernel.astrale.ai:class.Domain', path: '/manager-ui.astrale.ai' }]
    expect(extractDomainSlug(nodes)).toBe('manager-ui.astrale.ai')
  })

  test('accepts the {raw} class wrapper and the /self suffix', () => {
    const nodes = [
      {
        class: { raw: '/:kernel.astrale.ai:class.Domain/self' },
        props: { origin: 'petstore.localhost' },
      },
    ]
    expect(extractDomainSlug(nodes)).toBe('petstore.localhost')
  })

  test('returns undefined when there is no Domain node', () => {
    expect(extractDomainSlug([{ class: '/:kernel.astrale.ai:class.Folder' }])).toBeUndefined()
    expect(extractDomainSlug([])).toBeUndefined()
  })
})

describe('spec — findFirstRemoteUrl', () => {
  test('reads remoteUrl from the JSON-string binding prop', () => {
    const nodes = [
      { class: '/:kernel.astrale.ai:class.Folder', props: {} },
      {
        path: '/manager-ui.astrale.ai/core/views/console',
        props: { [BINDING_KEY]: '{"remoteUrl":"http://localhost:8844/views/console"}' },
      },
    ]
    expect(findFirstRemoteUrl(nodes)).toBe('http://localhost:8844/views/console')
  })

  test('accepts the object form of the binding prop', () => {
    const nodes = [{ props: { [BINDING_KEY]: { remoteUrl: 'https://w.example/v' } } }]
    expect(findFirstRemoteUrl(nodes)).toBe('https://w.example/v')
  })

  test('returns undefined when no node carries a binding', () => {
    expect(findFirstRemoteUrl([{ props: {} }, { class: 'x' }])).toBeUndefined()
  })

  test('tolerates a malformed binding JSON string', () => {
    expect(findFirstRemoteUrl([{ props: { [BINDING_KEY]: '{not json' } }])).toBeUndefined()
  })
})
