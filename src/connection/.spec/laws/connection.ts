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

export const CLI_CONNECTION_ADMIN_CALL = defineLaw({
  id: 'CLI-CONNECTION-ADMIN-CALL',
  statement:
    'A command run on the Admin kernel resolves it exactly like Admin Domain operations (configured target, Admin bookmark, or URL with its Admin Domain issuer), never from -i/--url or the active instance, and selects a callable credential as on any other target: the declaring Domain issuer the Admin kernel installation names.',
  tests: [
    {
      file: '../commands/__tests__/call-admin.test.ts',
      id: 'TEST-CLI-CALL-ADMIN-SET-SECRET',
    },
    {
      file: '../commands/__tests__/call-admin.test.ts',
      id: 'TEST-CLI-CALL-ADMIN-REFUSES-INSTANCE-SELECTORS',
    },
  ],
})

export const CLI_CONNECTION_DOMAIN_EXCHANGE = defineLaw({
  id: 'CLI-CONNECTION-DOMAIN-EXCHANGE',
  statement:
    'A target with an explicit Domain issuer first admits an exact live caller-only exchange credential selected by the persisted IdP issuer and subject; any credential that adds Domain self or other authority is rejected. Only a miss resolves fresh source authority and asks the Kernel Client to exchange it at that Domain issuer (whoami at the exact Kernel, a delegation preserving that User for the Domain audience, the discovered standard endpoint), maps each Client exchange failure reason to its CLI error code, and returns a Domain token bound back to the same Kernel. Missing or mismatched local identity metadata falls through, and there is no inferred issuer or legacy broker fallback.',
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

export const CLI_CONNECTION_SOURCE_CREDENTIAL = defineLaw({
  id: 'CLI-CONNECTION-SOURCE-CREDENTIAL',
  statement:
    'Every invocation resolves its source credential at the pinned source Kernel, under the live Session operation signal, before routing; a remote destination receives a delegate carrier bounded strictly inside the source credential lifetime, never the source credential itself. An opaque or raw source credential is presented as it is, an explicit bearer must cover the command window, and a caller-principal nested credential skips the Domain exchange while keeping the selected human principal.',
  tests: [
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-RESOLVES-SOURCE-AUTH-BEFORE-ROUTING',
    },
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-BOUNDS-REMOTE-CARRIER-TO-SOURCE-LIFETIME',
    },
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-USES-RAW-SOURCE-CREDENTIAL',
    },
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-CALLER-PRINCIPAL-SKIPS-DOMAIN-EXCHANGE',
    },
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-PROPAGATES-AUTH-CANCELLATION',
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
    'Key identity registration lookup uses the same target key for bookmark, managed, Admin, and direct URL calls that identity registration stores, and signs the registered (issuer, subject).',
  tests: [
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-USES-PERSISTED-EXCHANGE-BEFORE-SOURCE-REFRESH',
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
      file: '__tests__/errors.test.ts',
      id: 'TEST-CLI-CONNECTION-ADMITS-BOUNDED-REASONS',
    },
    {
      file: '__tests__/errors.test.ts',
      id: 'TEST-CLI-CONNECTION-FAILURE-SAFETY',
    },
  ],
})

export const CLI_CONNECTION_MANAGED_USER_ACTS_FOR_ITSELF = defineLaw({
  id: 'CLI-CONNECTION-MANAGED-USER-ACTS-FOR-ITSELF',
  statement:
    'A managed Instance derives no exchange Domain from its route: its users act for themselves, so a graph command presents the selected identity, bounded by its own rules and by no Domain principal. Re-running `astrale instance use <slug>` resets a managed bookmark to act so; an explicit exact Domain issuer a user sets on any bookmark is still exchanged at.',
  tests: [
    {
      file: '../lib/__tests__/instance-target.test.ts',
      id: 'TEST-CLI-INSTANCE-MANAGED-USER-ACTS-FOR-ITSELF',
    },
    {
      file: '../lib/__tests__/instance-concurrency.test.ts',
      id: 'TEST-CLI-INSTANCE-USE-RESETS-MANAGED-ISSUER',
    },
  ],
})

export const CLI_CONNECTION_INSTALLED_ISSUER = defineLaw({
  id: 'CLI-CONNECTION-INSTALLED-ISSUER',
  statement:
    "A callable of an installed Domain, the Shell's included, exchanges at the issuer the source Kernel's pin names for its origin, read with schema.inspect through the Session that authenticates the source caller. The installation cache remembers what the pin named per source Kernel, so a later command exchanges there, or selects the Domain credential persisted under that issuer before resolving the source credential, without reading the pin again. A persisted credential the Kernel refuses with 2002 is forgotten, so no later command selects it again. A consented reinstall changes the issuer within one installation, so the record is healed, never trusted: a fresh exchange that fails as a moved issuer would (issuer unknown or 2002) reads the pin once more and retries once only when it moved, and keeps its failure and what the session holds when the pin cannot be read again; any failure of a command that relied on the remembered issuer forgets it, and so does any Kernel call of that command the Kernel refuses with 2002, even one the command recovers from, so the next command reads the pin and no command sends a stale remembered issuer after one has failed; a command that read the pin itself keeps the record. In every bookmark registry, labelled or unlabelled, every explicit exact Domain issuer is the user's and wins, whatever its value. Every bookmark write rewrites the registry with the format label. A pin the Kernel refuses to read (the Domain absent or not ready, the read denied or not served) or answers with invalid evidence fails with a typed error naming its cause; other read failures keep their own classification.",
  tests: [
    {
      file: '__tests__/installed-issuer.test.ts',
      id: 'TEST-CLI-INSTALLED-SHELL-DEPLOYMENT-ISSUER',
    },
    {
      file: '__tests__/installed-issuer.test.ts',
      id: 'TEST-CLI-INSTALLED-SHELL-STALE-ISSUER-RECOVERS-ONCE',
    },
    {
      file: '__tests__/installed-issuer.test.ts',
      id: 'TEST-CLI-INSTALLED-SHELL-ISSUER-UNRESOLVED',
    },
    {
      file: '__tests__/installed-issuer.test.ts',
      id: 'TEST-CLI-INSTALLED-SHELL-READ-FAILURE-KEEPS-CLASSIFICATION',
    },
    {
      file: '__tests__/installed-issuer.test.ts',
      id: 'TEST-CLI-INSTALLED-SHELL-READ-ONCE-PER-BOOKMARK',
    },
    {
      file: '__tests__/installed-issuer.test.ts',
      id: 'TEST-CLI-INSTALLED-SHELL-REINSTALL-HEALS-WITHIN-COMMAND',
    },
    {
      file: '__tests__/installed-issuer.test.ts',
      id: 'TEST-CLI-INSTALLED-SHELL-STALE-ISSUER-NEVER-SENT-TWICE',
    },
    {
      file: '__tests__/installed-issuer.test.ts',
      id: 'TEST-CLI-INSTALLED-SHELL-CONCURRENT-REFUSALS-HEAL',
    },
    {
      file: '__tests__/installed-issuer.test.ts',
      id: 'TEST-CLI-INSTALLED-SHELL-FAILURE-FORGETS-REMEMBERED-ONLY',
    },
    {
      file: '__tests__/installed-issuer.test.ts',
      id: 'TEST-CLI-INSTALLED-SHELL-REFUSED-CREDENTIAL-FORGOTTEN',
    },
    {
      file: '__tests__/credential.test.ts',
      id: 'TEST-CLI-CONNECTION-INSTALLED-ISSUER-SERVES-EXCHANGE',
    },
    {
      file: '__tests__/installed-issuer.test.ts',
      id: 'TEST-CLI-INSTALLED-SHELL-INSPECT-DECODED',
    },
    {
      file: '../lib/__tests__/instance.test.ts',
      id: 'TEST-CLI-INSTANCE-LABELLED-REGISTRY-ISSUER-KEPT',
    },
  ],
})

export const CLI_CONNECTION_CALLABLE_ISSUER_REMEMBERED = defineLaw({
  id: 'CLI-CONNECTION-CALLABLE-ISSUER-REMEMBERED',
  statement:
    'A callable command reads the installed Domain of its declaring origin once per source Kernel and reuses the remembered issuer, or the Kernel-hosted verdict, without opening a discovery Session. Any failure of a command that relied on a remembered issuer forgets it, so the next command reads the installation again; a remembered issuer grants nothing, because the Kernel still admits every exchanged credential. An unusable cache is a miss.',
  tests: [
    { file: '__tests__/callable-target.test.ts', id: 'TEST-CLI-CALLABLE-ISSUER-READ-ONCE' },
    {
      file: '__tests__/callable-target.test.ts',
      id: 'TEST-CLI-CALLABLE-ISSUER-FORGOTTEN-ON-FAILURE',
    },
  ],
})
