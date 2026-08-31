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

export const CLI_CONNECTION_DOMAIN_EXCHANGE = defineLaw({
  id: 'CLI-CONNECTION-DOMAIN-EXCHANGE',
  statement:
    'A target with an explicit Domain issuer first admits an exact live caller-only exchange credential selected by the persisted IdP issuer and subject; any credential that adds Domain self or other authority is rejected. Only a miss resolves fresh source authority, authenticates whoami at the exact Kernel, requests explicit self attenuation for that User and Domain audience, posts the envelope to the discovered standard endpoint, and returns a Domain token bound back to the same Kernel. Missing or mismatched local identity metadata falls through, and there is no inferred issuer or legacy broker fallback.',
  tests: [
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-USES-PERSISTED-EXCHANGE-BEFORE-SOURCE-REFRESH',
    },
    {
      file: '__tests__/exchange.test.ts',
      id: 'TEST-CLI-EXCHANGE-WHOAMI-DELEGATE-EXCHANGE-CACHE',
    },
    {
      file: '__tests__/exchange.test.ts',
      id: 'TEST-CLI-EXCHANGE-NO-LEGACY-FALLBACK',
    },
    {
      file: '__tests__/exchange.test.ts',
      id: 'TEST-CLI-EXCHANGE-REJECTS-DOMAIN-SELF-AUTHORITY',
    },
    {
      file: '../state/__tests__/exchange-credentials.test.ts',
      id: 'TEST-CLI-EXCHANGE-CACHE-REJECTS-DOMAIN-SELF-AUTHORITY',
    },
  ],
})

export const CLI_CONNECTION_HOP_CREDENTIAL = defineLaw({
  id: 'CLI-CONNECTION-HOP-CREDENTIAL',
  statement:
    'A source hop resolves a fresh credential only when its session-pinned issuer equals the selected source issuer; a destination hop requires the same selected resolver and returns a fresh delegation for the witnessed Publication issuer, never the source credential, with its TTL bounded strictly inside any source JWT expiry.',
  tests: [
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-RESOLVES-CREDENTIAL-PER-HOP',
    },
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-DELEGATES-VIA-SOURCE-AUTH',
    },
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-REJECTS-HOP-SOURCE-ISSUER-MISMATCH',
    },
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-BOUNDS-DELEGATION-TO-SOURCE-EXPIRY',
    },
  ],
})

export const CLI_CONNECTION_EXPLICIT_ANONYMOUS = defineLaw({
  id: 'CLI-CONNECTION-EXPLICIT-ANONYMOUS',
  statement:
    'An explicit anonymous selection suppresses ambient, bookmark-default, and local credentials by omitting the Host credential capability; it is rejected before connection construction when combined with --as or --creds.',
  tests: [
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-OMITS-EXPLICIT-ANONYMOUS-CREDENTIAL',
    },
    {
      file: '__tests__/session.test.ts',
      id: 'TEST-CLI-CONNECTION-REJECTS-ANONYMOUS-CREDENTIAL-CONFLICT',
    },
  ],
})

export const CLI_CONNECTION_SOURCE_ISSUER = defineLaw({
  id: 'CLI-CONNECTION-SOURCE-ISSUER',
  statement:
    'CLI constructs ClientSession once with sourceIssuer equal to the selected ConnectionTarget issuer independently from its invocation URL, so path-multiplexed Kernels do not substitute root Publication discovery; every credential hop repeats that pin.',
  tests: [
    {
      file: '__tests__/session.test.ts',
      id: 'TEST-CLI-CONNECTION-PINS-SOURCE-ISSUER',
    },
  ],
})

export const CLI_CONNECTION_ISSUER_DISCOVERY = defineLaw({
  id: 'CLI-CONNECTION-ISSUER-DISCOVERY',
  statement:
    'When invocation URL and issuer differ, liveness probes resolve OIDC metadata at the pinned issuer and reject metadata that declares any other issuer before fetching its keys.',
  tests: [
    {
      file: '../lib/__tests__/meta.test.ts',
      id: 'TEST-CLI-CONNECTION-PROBES-PINNED-ISSUER',
    },
    {
      file: '../lib/__tests__/meta.test.ts',
      id: 'TEST-CLI-CONNECTION-REJECTS-DISCOVERY-ISSUER-MISMATCH',
    },
  ],
})

export const CLI_AUTH_REGISTRATION_TARGET = defineLaw({
  id: 'CLI-AUTH-REGISTRATION-TARGET',
  statement:
    'Key identity registration lookup uses the same target key for bookmark, managed, Admin, and direct URL calls that identity registration stores.',
  tests: [
    {
      file: '__tests__/auth.test.ts',
      id: 'TEST-CLI-AUTH-USES-DIRECT-URL-REGISTRATION',
    },
  ],
})

export const CLI_SELF_AUTHENTICATED_PRINCIPAL = defineLaw({
  id: 'CLI-SELF-AUTHENTICATED-PRINCIPAL',
  statement:
    '@self resolves inside the command-owned Client Session from authenticated Identity.whoami on the selected target, so resolution and dispatch share one lifecycle and delegated carriers never use an unverified JWT subject or stale local registration.',
  tests: [
    {
      file: '__tests__/self.test.ts',
      id: 'TEST-CLI-SELF-USES-AUTHENTICATED-EFFECTIVE-PRINCIPAL',
    },
  ],
})

export const CLI_CONNECTION_TERMINAL_CLOSE = defineLaw({
  id: 'CLI-CONNECTION-TERMINAL-CLOSE',
  statement:
    'The Client Session and direct source-Auth client close exactly once after action success, failure, or cancellation.',
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
    'The CLI accepts only a positive integer timeout before constructing a Client Session, applies it to source-Auth and Session operations, and requires exchanged and destination-carrier authority to cover that timeout plus the bounded receipt margin before destination dispatch.',
  tests: [
    {
      file: '__tests__/session.test.ts',
      id: 'TEST-CLI-CONNECTION-REJECTS-INVALID-TIMEOUT-BEFORE-OPEN',
    },
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-CARRIER-COVERS-COMMAND-TIMEOUT',
    },
    {
      file: '__tests__/exchange.test.ts',
      id: 'TEST-CLI-EXCHANGE-REJECTS-INSUFFICIENT-LIFETIME',
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

export const CLI_CONNECTION_CALL_SHAPE = defineLaw({
  id: 'CLI-CONNECTION-CALL-SHAPE',
  statement:
    'Caller-authored path text and input enter Client as exactly one public Call; the CLI retains no optional callable hint, caller ETag, or second dispatch representation.',
  tests: [
    {
      file: '__tests__/call.test.ts',
      id: 'TEST-CLI-CONNECTION-CREATES-ONE-CANONICAL-CALL',
    },
  ],
})

export const CLI_CONNECTION_PUBLIC_SEMANTIC_REASON = defineLaw({
  id: 'CLI-CONNECTION-PUBLIC-SEMANTIC-REASON',
  statement:
    'Machine-mode Kernel command failures preserve the admitted ResponseError code and public semantic reason so scripts can distinguish conflicts such as revision guards and required data migrations without parsing prose.',
  tests: [
    {
      file: '__tests__/errors.test.ts',
      id: 'TEST-CLI-CONNECTION-PRESERVES-PUBLIC-SEMANTIC-REASON',
    },
  ],
})

export const CLI_CONNECTION_TYPED_ERROR_PRESENTATION = defineLaw({
  id: 'CLI-CONNECTION-TYPED-ERROR-PRESENTATION',
  statement:
    'The command boundary maps typed Client failure identity, transport context, phase, and invocation-only delivery evidence without parsing a private cause; acquisition never receives retry advice, unknown native failures have one non-blank unexpected diagnostic, and raw causes appear only under explicit debug output.',
  tests: [
    {
      file: '__tests__/errors.test.ts',
      id: 'TEST-CLI-CONNECTION-MAPS-TYPED-TRANSPORT',
    },
    {
      file: '__tests__/errors.test.ts',
      id: 'TEST-CLI-CONNECTION-PRESENTS-BOUNDED-REPAIRS',
    },
    {
      file: '__tests__/reasons.test.ts',
      id: 'TEST-CLI-CONNECTION-ADMITS-BOUNDED-REASONS',
    },
    {
      file: '__tests__/failure-safety.test.ts',
      id: 'TEST-CLI-CONNECTION-FAILURE-SAFETY',
    },
  ],
})
