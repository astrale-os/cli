import { describe, expect, test } from 'bun:test'

import { releaseUpdateArgs, shouldRunStartupMaintenance } from '../startup-maintenance'

describe('startup maintenance admission', () => {
  test('runs only for ordinary interactive commands', () => {
    expect(shouldRunStartupMaintenance(['astrale', 'bin', 'get'], {}, true)).toBe(true)
    expect(shouldRunStartupMaintenance(['astrale', 'bin'], {}, true)).toBe(false)
    expect(shouldRunStartupMaintenance(['astrale', 'bin', 'get'], {}, false)).toBe(false)
  })

  test('never interferes with explicit maintenance, help, or machine mode', () => {
    for (const args of [
      ['update'],
      ['skills', 'status'],
      ['setup'],
      ['get', '--json'],
      ['get', '--no-prompt'],
      ['--help'],
      ['--version'],
    ]) {
      expect(shouldRunStartupMaintenance(['astrale', 'bin', ...args], {}, true)).toBe(false)
    }
    expect(shouldRunStartupMaintenance(['astrale', 'bin', 'get'], { CI: '1' }, true)).toBe(false)
    expect(
      shouldRunStartupMaintenance(['astrale', 'bin', 'get'], { ASTRALE_UPDATE_REEXEC: '1' }, true),
    ).toBe(false)
  })
})

describe('startup release update', () => {
  test('applies the offered release from the channel it was read on', () => {
    expect(releaseUpdateArgs({ channel: 'beta' })).toEqual([
      'update',
      '--no-deps',
      '--channel',
      'beta',
    ])
  })
})
