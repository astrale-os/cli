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

export const CLI_UI_BOUNDED_REMOTE_DOCUMENTS = defineLaw({
  id: 'CLI-UI-BOUNDED-REMOTE-DOCUMENTS',
  statement:
    'Release metadata and registry documents are size-bounded, include-bounded, and normalized to stable UI registry errors before any project mutation.',
  tests: [{ file: '../__tests__/ui.test.ts', id: 'TEST-CLI-UI-BOUNDED-REMOTE-DOCUMENTS' }],
})

export const CLI_UI_EXACT_ITEM_SOURCE = defineLaw({
  id: 'CLI-UI-EXACT-ITEM-SOURCE',
  statement:
    'An add operation admits the exact built item document against the release index and records its content-bearing source digest before any consumer mutation; only patterns and blocks invoke project tooling.',
  tests: [{ file: '../__tests__/ui.test.ts', id: 'TEST-CLI-UI-EXACT-ITEM-SOURCE' }],
})

export const CLI_UI_THEME_OWNERSHIP = defineLaw({
  id: 'CLI-UI-THEME-OWNERSHIP',
  statement:
    'A released or locally exported theme becomes one project-contained consumer-owned CSS file, is activated by one relative host stylesheet import, and rolls back file, import, and lock together on failure.',
  tests: [{ file: '../__tests__/ui.test.ts', id: 'TEST-CLI-UI-THEME-OWNERSHIP' }],
})

export const CLI_UI_SEMANTIC_DIFF = defineLaw({
  id: 'CLI-UI-SEMANTIC-DIFF',
  statement:
    'Diff is read-only, path-contained, and classifies locked source and files as upstream changed, unchanged, modified, or deleted without delegating truth to tool output.',
  tests: [{ file: '../__tests__/ui.test.ts', id: 'TEST-CLI-UI-SEMANTIC-DIFF' }],
})
