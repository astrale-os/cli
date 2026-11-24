import { NODE_NAME_MAXIMUM_LENGTH, SelectionRefusedError } from '@astrale-os/shell'
import { describe, expect, test } from 'bun:test'

import { NODE_SELECTOR_MAXIMUM, viewHostCapabilities } from '../view/host-capabilities'
import {
  type PlaceStorage,
  parseRememberedPlace,
  refusalMessage,
  rememberedPlaceOf,
  rememberPlace,
  selectedNode,
} from '../view/node-selection'
import { isViewerFile, viewerFileContentType } from '../view/viewer-files'

const ISSUE = 'issues.astrale.ai:class.Issue'

function memoryStorage(): PlaceStorage & { readonly items: Map<string, string> } {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  }
}

describe('astrale view node selector', () => {
  test('grants every hosted View the node selector, up to its maximum', () => {
    expect(viewHostCapabilities([]).graph).toEqual({
      select: { maximumNodes: NODE_SELECTOR_MAXIMUM },
    })
    expect(NODE_SELECTOR_MAXIMUM).toBe(16)
  })

  test('hands a View each chosen Node with its id, Class and a name it may carry', () => {
    expect(selectedNode({ id: 'n1', class: ISSUE, name: 'Fix login' })).toEqual({
      id: 'n1',
      class: ISSUE,
      name: 'Fix login',
    })
    const long = 'x'.repeat(NODE_NAME_MAXIMUM_LENGTH + 40)
    const shortened = selectedNode({ id: 'n2', class: ISSUE, name: long }).name
    expect(shortened).toHaveLength(NODE_NAME_MAXIMUM_LENGTH)
    expect(shortened.endsWith('…')).toBe(true)
    const exact = 'y'.repeat(NODE_NAME_MAXIMUM_LENGTH)
    expect(selectedNode({ id: 'n3', class: ISSUE, name: exact }).name).toBe(exact)
  })

  test('names the Nodes the Shell refuses, and nothing for any other failure', () => {
    const refused = new SelectionRefusedError([
      { id: 'a', class: ISSUE, name: 'Alpha' },
      { id: 'b', class: ISSUE, name: 'Beta' },
    ] as never)
    expect(refusalMessage(refused)).toBe('Alpha and Beta can no longer be selected')
    expect(refusalMessage(new SelectionRefusedError([]))).toBeUndefined()
    expect(refusalMessage(new Error('network'))).toBeUndefined()
  })

  test('opens where the same identity left off on the same instance, and nowhere else', () => {
    const storage = memoryStorage()
    const place = { domain: 'issues.astrale.ai', classes: [ISSUE] }
    rememberPlace(storage, 'https://kernel.test', 'alice', place)

    expect(rememberedPlaceOf(storage, 'https://kernel.test', 'alice')).toEqual(place)
    expect(rememberedPlaceOf(storage, 'https://kernel.test', 'bob')).toBeUndefined()
    expect(rememberedPlaceOf(storage, 'https://other.test', 'alice')).toBeUndefined()
    expect(rememberedPlaceOf(undefined, 'https://kernel.test', 'alice')).toBeUndefined()

    // An unchanged place is not written again; storage that throws is never fatal.
    const writes: string[] = []
    const counting: PlaceStorage = {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => void writes.push(value),
    }
    rememberPlace(counting, 'https://kernel.test', 'alice', place)
    expect(writes).toEqual([])
    const broken: PlaceStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(() => rememberPlace(broken, 'https://kernel.test', 'alice', place)).not.toThrow()
    expect(rememberedPlaceOf(broken, 'https://kernel.test', 'alice')).toBeUndefined()
  })

  test('reads back only a well-formed place', () => {
    expect(parseRememberedPlace(null)).toBeNull()
    expect(parseRememberedPlace('not json')).toBeNull()
    expect(parseRememberedPlace('null')).toBeNull()
    expect(parseRememberedPlace(JSON.stringify({ place: {} }))).toBeNull()
    expect(parseRememberedPlace(JSON.stringify({ identity: 'a', place: null }))).toBeNull()
    expect(parseRememberedPlace(JSON.stringify({ identity: 'a', place: { domain: 4 } }))).toBeNull()
    expect(
      parseRememberedPlace(JSON.stringify({ identity: 'a', place: { classes: ['x', 1] } })),
    ).toBeNull()
    expect(
      parseRememberedPlace(
        JSON.stringify({ identity: 'a', place: { domain: 'd', classes: ['x'], node: 'n' } }),
      ),
    ).toEqual({ identity: 'a', place: { domain: 'd', classes: ['x'] } })
    expect(parseRememberedPlace(JSON.stringify({ identity: 'a', place: {} }))).toEqual({
      identity: 'a',
      place: {},
    })
  })

  test('serves exactly the files a viewer build emits, each with its type', () => {
    expect(viewerFileContentType('/main.js')).toBe('text/javascript; charset=utf-8')
    expect(viewerFileContentType('/chunk-ab12cd34.js')).toBe('text/javascript; charset=utf-8')
    expect(viewerFileContentType('/finder.css')).toBe('text/css; charset=utf-8')
    expect(viewerFileContentType('/fonts/hanken-grotesk-latin-wght-normal.woff2')).toBe(
      'font/woff2',
    )
    for (const path of [
      '/',
      '/index.html',
      '/config.json',
      '/fonts/HankenGrotesk-OFL.txt',
      '/fonts/../main.js',
      '/chunk-../../etc.js',
      '/chunk-AB.js',
      '/other.js',
      '/fonts/sub/x.woff2',
      '//main.js',
    ]) {
      expect(viewerFileContentType(path)).toBeUndefined()
    }
    for (const path of ['index.html', 'main.js', 'fonts/HankenGrotesk-OFL.txt', 'finder.css']) {
      expect(isViewerFile(path)).toBe(true)
    }
    for (const path of ['main.js.map', 'island.js', 'fonts/x.ttf', 'nested/main.js']) {
      expect(isViewerFile(path)).toBe(false)
    }
  })
})
