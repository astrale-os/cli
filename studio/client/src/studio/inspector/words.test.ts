import { describe, expect, test } from 'bun:test'

import { indefiniteArticle, opening, withArticle } from './words'

describe('the indefinite article', () => {
  test('follows the sound a word opens with, not its letter', () => {
    expect(withArticle('action')).toBe('an action')
    expect(withArticle('Identity')).toBe('an Identity')
    expect(withArticle('Integration')).toBe('an Integration')
    expect(withArticle('Host link')).toBe('a Host link')
    expect(withArticle('User')).toBe('a User')
    expect(withArticle('unique key')).toBe('a unique key')
    expect(withArticle('upgrade')).toBe('an upgrade')
    expect(withArticle('hour')).toBe('an hour')
    expect(withArticle('one-time code')).toBe('a one-time code')
  })

  test('an initialism reads by its letters', () => {
    expect(indefiniteArticle('MCP')).toBe('an')
    expect(indefiniteArticle('SDK')).toBe('an')
    expect(indefiniteArticle('KV')).toBe('a')
    expect(indefiniteArticle('URL')).toBe('a')
  })

  test('a phrase opening a sentence takes a capital', () => {
    expect(opening(withArticle('action'))).toBe('An action')
    expect(opening('a workflow')).toBe('A workflow')
  })
})
