import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_PROGRAM_DOCUMENTED_SURFACE = defineLaw({
  id: 'CLI-PROGRAM-DOCUMENTED-SURFACE',
  statement:
    'Every `astrale` command a shipped skill documents parses against the command tree, and the program version is the package version.',
  tests: [
    {
      file: '__tests__/skill-examples.test.ts',
      id: 'TEST-CLI-PROGRAM-SKILL-EXAMPLES-PARSE',
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
