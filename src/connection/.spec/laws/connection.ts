import { defineLaw } from '@astrale-os/spec/authoring'

export const CLI_CONNECTION_TARGET = defineLaw({
  id: 'CLI-CONNECTION-TARGET',
  statement:
    'Explicit URL, explicit instance, active bookmark, managed lookup, and Admin target selection preserve the existing precedence while returning the exact invocation URL and issuer separately.',
  tests: [
    {
      file: '__tests__/target.test.ts',
      id: 'TEST-CLI-CONNECTION-SELECTS-EXACT-TARGET',
    },
  ],
})

export const CLI_CONNECTION_HOP_CREDENTIAL = defineLaw({
  id: 'CLI-CONNECTION-HOP-CREDENTIAL',
  statement:
    'A source hop resolves a fresh credential for its admitted Publication issuer; a redirected hop first authenticates to its admitted resolver and returns a fresh delegation for the destination Publication issuer, never the source credential.',
  tests: [
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-RESOLVES-CREDENTIAL-PER-HOP',
    },
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-DELEGATES-VIA-SOURCE-AUTH',
    },
  ],
})

export const CLI_CONNECTION_TERMINAL_CLOSE = defineLaw({
  id: 'CLI-CONNECTION-TERMINAL-CLOSE',
  statement:
    'The Host session and direct source-Auth client close exactly once after action success, failure, or cancellation.',
  tests: [
    {
      file: '__tests__/session.test.ts',
      id: 'TEST-CLI-CONNECTION-CLOSES-OWNED-CLIENTS',
    },
  ],
})

export const CLI_CONNECTION_TIMEOUT = defineLaw({
  id: 'CLI-CONNECTION-TIMEOUT',
  statement:
    'The CLI accepts only a positive integer timeout before constructing a Host session and applies it to both source-Auth and Host operations.',
  tests: [
    {
      file: '__tests__/session.test.ts',
      id: 'TEST-CLI-CONNECTION-REJECTS-INVALID-TIMEOUT-BEFORE-OPEN',
    },
  ],
})

export const CLI_CONNECTION_CA_SCOPE = defineLaw({
  id: 'CLI-CONNECTION-CA-SCOPE',
  statement:
    'A selected bookmark CA file changes only the Fetch capability owned by this connection and leaves non-HTTPS requests on the injected fallback Fetch.',
  tests: [
    {
      file: '__tests__/ca-fetch.test.ts',
      id: 'TEST-CLI-CONNECTION-SCOPES-CUSTOM-CA-TO-HTTPS-FETCH',
    },
  ],
})
