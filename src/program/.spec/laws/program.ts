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

export const CLI_PROGRAM_TYPED_FAILURES = defineLaw({
  id: 'CLI-PROGRAM-TYPED-FAILURES',
  statement:
    'A failure the person can act on MUST be refused with its own typed code, message, and hint, exit 1, before any connection or state change; any other failure MUST be reported once by the binary as UNEXPECTED_ERROR, exit 1, with no source or stack. CLI process code constructs no bare Error.',
  tests: [
    { file: '__tests__/typed-failures.test.ts', id: 'TEST-CLI-PROGRAM-NO-UNTYPED-ERRORS' },
    { file: '__tests__/typed-failures.test.ts', id: 'TEST-CLI-PROGRAM-REFUSALS-TYPED' },
    { file: '__tests__/typed-failures.test.ts', id: 'TEST-CLI-PROGRAM-UNTYPED-FAILURE-OPAQUE' },
  ],
})
