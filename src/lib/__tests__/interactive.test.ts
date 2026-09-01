import { describe, expect, test } from 'bun:test'

import { canPrompt, canReadRequiredInput } from '../interactive'

// Every input is injected: the rule must hold identically whether the suite
// runs from a terminal, a pipe, or CI.
const terminal = { argv: ['astrale', 'bin', 'get'], env: {}, tty: true }

describe('canPrompt — one rule for every question', () => {
  test('a human on both ends with no opt-out may be asked', () => {
    expect(canPrompt(terminal)).toBe(true)
  })

  test('a pipe on either end is never asked', () => {
    expect(canPrompt({ ...terminal, tty: false })).toBe(false)
  })

  test('a CI runner is never asked', () => {
    expect(canPrompt({ ...terminal, env: { CI: '1' } })).toBe(false)
    expect(canPrompt({ ...terminal, env: { CONTINUOUS_INTEGRATION: '1' } })).toBe(false)
  })

  // The four flags live on argv because --ci / --no-prompt are declared on the
  // root program: Commander keeps them in program.opts() and never hands them
  // to a subcommand action, so `opts.ci` inside a command is always undefined.
  test.each(['--ci', '--no-prompt', '--json', '--raw'])('%s opts out', (flag) => {
    expect(canPrompt({ ...terminal, argv: ['astrale', 'bin', 'get', flag] })).toBe(false)
  })

  // Internal callers drive commands as functions, with no argv to speak for them.
  test('a programmatic caller can opt out without argv', () => {
    expect(canPrompt({ ...terminal, noPrompt: true })).toBe(false)
    expect(canPrompt({ ...terminal, ci: true })).toBe(false)
  })
})

describe('canReadRequiredInput — required input, not an optional question', () => {
  // --json shapes the result; it does not mean the operator walked away. A
  // passphrase the command cannot proceed without is still readable.
  test.each(['--json', '--raw'])('%s does not block required input', (flag) => {
    expect(canReadRequiredInput({ ...terminal, argv: ['astrale', 'bin', 'get', flag] })).toBe(true)
  })

  test.each(['--ci', '--no-prompt'])('%s still refuses', (flag) => {
    expect(canReadRequiredInput({ ...terminal, argv: ['astrale', 'bin', 'get', flag] })).toBe(false)
  })

  test('a pipe or a CI runner still refuses', () => {
    expect(canReadRequiredInput({ ...terminal, tty: false })).toBe(false)
    expect(canReadRequiredInput({ ...terminal, env: { CI: '1' } })).toBe(false)
  })
})
