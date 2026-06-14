import { describe, expect, test } from 'bun:test'

import { guiOrigin, slugError, urlError } from '../util'

describe('guiOrigin — the clickable instance URL', () => {
  test('strips the /api path bookmarks carry', () => {
    expect(guiOrigin('https://my-app.eu.astrale.ai/api')).toBe('https://my-app.eu.astrale.ai')
  })

  test('leaves a bare origin untouched', () => {
    expect(guiOrigin('https://my-app.eu.astrale.ai')).toBe('https://my-app.eu.astrale.ai')
  })

  test('returns the input verbatim when it is not a URL', () => {
    expect(guiOrigin('not a url')).toBe('not a url')
  })
})

describe('inquirer validators', () => {
  test('slugError accepts a DNS-label slug and rejects junk', () => {
    expect(slugError('my-app')).toBe(true)
    expect(typeof slugError('Not A Slug')).toBe('string')
  })

  test('urlError accepts http(s) and rejects junk', () => {
    expect(urlError('https://admin.eu.astrale.ai/api')).toBe(true)
    expect(typeof urlError('ftp://nope')).toBe('string')
  })
})
