import { describe, expect, test } from 'bun:test'

import {
  confirm,
  confirmDefaultYes,
  confirmWithInput,
  promptMultiSelect,
  promptSelect,
  promptText,
  promptYesNo,
  readPassphrase,
  selectFrom,
} from '../prompt'

// The non-interactive branch IS the LLM / CI / piped case: every helper must
// resolve to its caller's default without ever awaiting a read, so a command
// fails fast on its required-flag error instead of hanging. The gate is passed
// explicitly rather than mutated onto `process` — the suite then behaves the
// same whether it runs from a terminal or a pipe, and can never hang.
const closed = { tty: false } as const

describe('prompts — a closed terminal never blocks on input', () => {
  test('promptText falls back to the caller default', async () => {
    expect(await promptText('Domain origin', { ...closed, default: 'crm.acme.dev' })).toBe(
      'crm.acme.dev',
    )
  })

  test('promptText yields undefined with no default (caller hits its required-flag error)', async () => {
    expect(await promptText('Published worker URL', closed)).toBeUndefined()
  })

  // promptYesNo answers `undefined`, not `false`: "nobody was there to ask" is
  // not "the user said no", and callers such as the skill-install offer record
  // a decline only for a real one.
  test('promptYesNo yields undefined rather than a fabricated answer', async () => {
    expect(await promptYesNo('Update them now?', { ...closed, default: true })).toBeUndefined()
    expect(await promptYesNo('Update them now?', closed)).toBeUndefined()
  })

  test('confirm defaults to No and confirmDefaultYes to Yes', async () => {
    expect(await confirm('Overwrite it?', closed)).toBe(false)
    expect(await confirmDefaultYes('Update them now?', closed)).toBe(true)
  })

  test('a dangerous action is never confirmed by default', async () => {
    expect(await confirmWithInput('DANGER', 'crm.acme.dev', closed)).toBe(false)
  })

  test('selectors resolve to their empty answer', async () => {
    expect(await promptSelect('Pick', [{ name: 'a', value: 'a' }], closed)).toBeUndefined()
    expect(await promptMultiSelect('Pick', [{ name: 'a', value: 'a' }], closed)).toBeUndefined()
    expect(await selectFrom('Pick', [{ label: 'a', value: 'a' }], closed)).toBeNull()
  })
})

describe('readPassphrase', () => {
  test('takes the env override before considering the terminal', async () => {
    expect(
      await readPassphrase('Passphrase', { ...closed, env: { ASTRALE_PASSPHRASE: 's3cret' } }),
    ).toBe('s3cret')
  })

  test('refuses with an actionable message when there is no terminal to read from', async () => {
    expect(readPassphrase('Passphrase', { ...closed, env: {} })).rejects.toThrow(
      /ASTRALE_PASSPHRASE/,
    )
  })

  // --ci promises that nothing blocks, so it refuses even at a live terminal.
  // (--json does NOT refuse — it shapes output, it does not mean the operator
  // left — which `interactive.test.ts` pins down without needing a real TTY.)
  test('refuses under --ci even with a terminal attached', async () => {
    expect(
      readPassphrase('Passphrase', {
        tty: true,
        argv: ['astrale', 'bin', 'identity', 'export', '--ci'],
        env: {},
      }),
    ).rejects.toThrow(/ASTRALE_PASSPHRASE/)
  })
})
