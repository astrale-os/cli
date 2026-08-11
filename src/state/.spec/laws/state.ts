import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_STATE_PATHS_CAPTURED = defineLaw({
  id: 'CLI-STATE-PATHS-CAPTURED',
  statement:
    'Path construction applies explicit-home then environment then platform-home precedence once; later environment mutation cannot change the returned coordinates.',
  tests: [{ file: '__tests__/paths.test.ts', id: 'TEST-CLI-STATE-PATHS-CAPTURED' }],
})

export const CLI_STATE_ATOMIC_REPLACEMENT = defineLaw({
  id: 'CLI-STATE-ATOMIC-REPLACEMENT',
  statement:
    'A successful replacement publishes one complete mode-0600 file and leaves no temporary file; a failed replacement never publishes partial content.',
  tests: [
    { file: '__tests__/files.test.ts', id: 'TEST-CLI-STATE-ATOMIC-WRITE' },
    { file: '__tests__/files.test.ts', id: 'TEST-CLI-STATE-ATOMIC-WRITE-FAILURE' },
  ],
})

export const CLI_STATE_LOCK_BOUNDED = defineLaw({
  id: 'CLI-STATE-LOCK-BOUNDED',
  statement:
    'Contending transitions serialize, abandoned locks are recoverable, acquisition is bounded, and every acquired lock is released after success or failure.',
  tests: [
    { file: '__tests__/files.test.ts', id: 'TEST-CLI-STATE-LOCK-SERIALIZES' },
    { file: '__tests__/files.test.ts', id: 'TEST-CLI-STATE-LOCK-RECOVERS' },
    { file: '__tests__/files.test.ts', id: 'TEST-CLI-STATE-LOCK-RELEASES-AND-BOUNDS' },
  ],
})
