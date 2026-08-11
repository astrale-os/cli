import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_PROGRAM_FROZEN_SURFACE = defineLaw({
  id: 'CLI-PROGRAM-FROZEN-SURFACE',
  statement:
    'Program composition preserves the complete root and nested command metadata, options, aliases, visibility, Commander behavior, rendered help, and package-derived version.',
  tests: [
    {
      file: '__tests__/program.test.ts',
      id: 'TEST-CLI-PROGRAM-MATCHES-FROZEN-SURFACE',
    },
    {
      file: '__tests__/program.test.ts',
      id: 'TEST-CLI-PROGRAM-VERSION-SINGLE-SOURCE',
    },
  ],
})

export const CLI_PROGRAM_FRESH_ROOT = defineLaw({
  id: 'CLI-PROGRAM-FRESH-ROOT',
  statement:
    'Each build produces an independent unparsed Commander root; mutation by one consumer cannot alter a later build.',
  tests: [
    {
      file: '__tests__/program.test.ts',
      id: 'TEST-CLI-PROGRAM-BUILDS-ISOLATED-ROOTS',
    },
  ],
})
