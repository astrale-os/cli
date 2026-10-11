import { expect, test } from 'bun:test'

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
} from '../terminal/prompt'

// The non-interactive branch IS the LLM / CI / piped case: every helper must resolve to its
// caller's default without ever awaiting a read, so a command fails fast on its required-flag error
// instead of hanging. The gate is passed explicitly, so the suite behaves the same from a terminal
// or a pipe and can never hang.
const closed = { tty: false } as const

test('a closed terminal never blocks: every prompt resolves to its default or no answer', async () => {
  expect(await promptText('Origin', { ...closed, default: 'crm.acme.dev' })).toBe('crm.acme.dev')
  expect(await promptText('Published worker URL', closed)).toBeUndefined()
  // "Nobody was there to ask" is not "the user said no".
  expect(await promptYesNo('Update them now?', { ...closed, default: true })).toBeUndefined()
  expect(await confirm('Overwrite it?', closed)).toBe(false)
  expect(await confirmDefaultYes('Update them now?', closed)).toBe(true)
  // A dangerous action is never confirmed by default.
  expect(await confirmWithInput('DANGER', 'crm.acme.dev', closed)).toBe(false)
  expect(await promptSelect('Pick', [{ name: 'a', value: 'a' }], closed)).toBeUndefined()
  expect(await promptMultiSelect('Pick', [{ name: 'a', value: 'a' }], closed)).toBeUndefined()
  expect(await selectFrom('Pick', [{ label: 'a', value: 'a' }], closed)).toBeNull()
})

test('a passphrase comes from the environment, else refuses without a usable terminal', async () => {
  const env = { ASTRALE_PASSPHRASE: 's3cret' }
  expect(await readPassphrase('Passphrase', { ...closed, env })).toBe('s3cret')
  await expect(readPassphrase('Passphrase', { ...closed, env: {} })).rejects.toThrow(
    /ASTRALE_PASSPHRASE/,
  )
  // --ci promises that nothing blocks, so it refuses even at a live terminal.
  const argv = ['astrale', 'bin', 'identity', 'export', '--ci']
  await expect(readPassphrase('Passphrase', { tty: true, argv, env: {} })).rejects.toThrow(
    /ASTRALE_PASSPHRASE/,
  )
})
