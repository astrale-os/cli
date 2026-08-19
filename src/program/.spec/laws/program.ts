import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_PROGRAM_LEDGERED_SURFACE = defineLaw({
  id: 'CLI-PROGRAM-LEDGERED-SURFACE',
  statement:
    'Program composition exposes one exact root and nested command surface; metadata, options, aliases, visibility, Commander behavior, rendered help, and package-derived version change only through a deliberate compatibility-ledger entry.',
  tests: [
    {
      file: '__tests__/program.test.ts',
      id: 'TEST-CLI-PROGRAM-MATCHES-LEDGERED-SURFACE',
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
