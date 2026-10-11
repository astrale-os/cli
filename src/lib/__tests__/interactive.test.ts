import { expect, test } from 'bun:test'

import { canPrompt, canReadRequiredInput } from '../interactive'

// Every input is injected: the rule must hold identically from a terminal, a pipe, or CI.
const terminal = { argv: ['astrale', 'bin', 'get'], env: {}, tty: true }
const flagged = (flag: string) => ({ ...terminal, argv: [...terminal.argv, flag] })

test('a question is asked only of a human on a terminal who did not opt out', () => {
  expect(canPrompt(terminal)).toBe(true)
  expect(canPrompt({ ...terminal, tty: false })).toBe(false)
  expect(canPrompt({ ...terminal, env: { CI: '1' } })).toBe(false)
  expect(canPrompt({ ...terminal, env: { CONTINUOUS_INTEGRATION: '1' } })).toBe(false)
  // The flags live on argv: Commander keeps root options away from subcommand actions.
  for (const flag of ['--ci', '--no-prompt', '--json', '--raw']) {
    expect(canPrompt(flagged(flag))).toBe(false)
  }
  // Internal callers drive commands as functions, with no argv to speak for them.
  expect(canPrompt({ ...terminal, noPrompt: true })).toBe(false)
  expect(canPrompt({ ...terminal, ci: true })).toBe(false)
})

test('required input survives --json and --raw, never --ci, --no-prompt, a pipe or CI', () => {
  // --json shapes the result; it does not mean the operator walked away.
  for (const flag of ['--json', '--raw']) expect(canReadRequiredInput(flagged(flag))).toBe(true)
  for (const flag of ['--ci', '--no-prompt'])
    expect(canReadRequiredInput(flagged(flag))).toBe(false)
  expect(canReadRequiredInput({ ...terminal, tty: false })).toBe(false)
  expect(canReadRequiredInput({ ...terminal, env: { CI: '1' } })).toBe(false)
})
