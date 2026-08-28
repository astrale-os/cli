import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_UI_BETA_DEFAULT = defineLaw({
  id: 'CLI-UI-BETA-DEFAULT',
  statement:
    'Until the UI V1 channel is promoted, an operation without an explicit version resolves the npm beta dist-tag and never the legacy latest dist-tag.',
  tests: [{ file: '../__tests__/ui.test.ts', id: 'TEST-CLI-UI-BETA-DEFAULT' }],
})

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

export const CLI_UI_SEARCH_LOCKED_RELEASE = defineLaw({
  id: 'CLI-UI-SEARCH-LOCKED-RELEASE',
  statement:
    'Search uses an initialized project exact UI lock without loading the registry and resolves npm beta only when no initialized lock owns the request.',
  tests: [
    {
      file: '../search/__tests__/search.test.ts',
      id: 'uses the exact project lock, returns canonical code, and never loads the registry',
    },
  ],
})

export const CLI_UI_SEARCH_INTEGRITY = defineLaw({
  id: 'CLI-UI-SEARCH-INTEGRITY',
  statement:
    'Search admits manifest, scorer, artifact, partition, and canonical code integrity before use and caches admitted bytes only under their immutable UI commit.',
  tests: [
    {
      file: '../search/__tests__/search.test.ts',
      id: 'repairs a corrupt cached index from the immutable release',
    },
  ],
})

export const CLI_UI_SEARCH_HANDOFF = defineLaw({
  id: 'CLI-UI-SEARCH-HANDOFF',
  statement:
    'Each returned registry candidate carries exact demo code and one directly executable astrale ui add command; runtime candidates carry their package import instead.',
  tests: [
    {
      file: '../search/__tests__/search.test.ts',
      id: 'hands a returned command directly to the existing add journey',
    },
  ],
})
