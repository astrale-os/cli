import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_UI_ONE_SNAPSHOT = defineLaw({
  id: 'CLI-UI-ONE-SNAPSHOT',
  statement:
    'Each UI operation resolves one immutable repository commit and reads compatibility, registry, and item source only from that snapshot.',
  tests: [{ file: '../__tests__/ui.test.ts', id: 'TEST-CLI-UI-ONE-SNAPSHOT' }],
})

export const CLI_UI_LOCK_AFTER_SUCCESS = defineLaw({
  id: 'CLI-UI-LOCK-AFTER-SUCCESS',
  statement:
    'Dry runs and failed package or source operations do not advance astrale-ui.lock.json.',
  tests: [{ file: '../__tests__/ui.test.ts', id: 'TEST-CLI-UI-LOCK-AFTER-SUCCESS' }],
})
