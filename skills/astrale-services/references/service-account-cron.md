# Plain Service → registered account → Domain callable

Use this pattern for a background worker or scheduled job calling an already installed Domain.
The Service itself need not publish an Application. For management calls and deployment payloads,
read [workflows.md](workflows.md) and [schema.md](schema.md).

## Ownership and authority

```text
Services.CloudflareWorker  owns compute, schedules and write-only secrets
Business.ServiceAccount  owns the callable's authenticated identity
Business Domain          owns the protected Function/Method and its effects
```

These are separate resources. Deploying compute neither creates nor registers an Identity, and
deleting a Service does not delete its account or uninstall a consumer Domain. Do not invent an
automatic graph link or shared privileged credential to join these lifecycles.

The business Domain can define `ServiceAccount extends Shell.User` for Shell membership support.
Use `astrale-domain` and its Users reference when authoring that Schema, including traversal
Policies on concrete foreign account/group classes participating in Shell memberships. A direct
Kernel Identity is valid for authentication; do not assume every Shell release accepts it as a
Group member. Inspect the installed `Group.assignMember` input contract.

For an `authorized` business callable, the ordinary external caller needs both callable authority
and the callable's business Policy.
For example, a custom Group can carry `can_use(Job.run)` and a business relation permitting the
target Job. Our qualification split these between two Groups to isolate each check; two Groups
are not a product requirement. Register does not grant either permission. Avoid Root, Shell admin,
or direct Query/Mutate permissions on the worker account unless its actual purpose requires them.

The deployer's identity and the worker account are separate choices. `CloudflareWorker.deploy` is
`authenticated`: a registered account may create its own Service. `serviceKey` is unique per owner,
so changing `--as` can create another Service rather than update the original. Receiver management
Methods still check ownership; knowing another Service's Node ID does not authorize its secrets.

## Provision once, authenticate on each execution

1. Create the account through its owning Domain, retaining the returned Node ID.
2. Generate a dedicated local key, then register it on that existing Node through an authorized
   caller or Domain callable. With the public CLI:

   ```sh
   astrale identity create background-job
   astrale identity register background-job --node @ACCOUNT_NODE -i INSTANCE --as REGISTRAR
   ```

   If the Domain supplies the required authority, use the command's `--via` contract instead.
   Registration must return the same Node. Do not create another account when retrying it.
3. Assign the intended custom Group(s) through `Shell.Group.assignMember`, with input `member`
   and `group`; this maintains the business membership and `extends_with` together.
4. Deploy plain compute, then provide the private JWK through `CloudflareWorker.setSecret` using
   stdin, never an argument value, graph property, source constant or logged payload.
5. Make a real call under the account before enabling a schedule.

A self proof authenticates the account itself: no `mint`, delegation or user exchange is required.
Use the exact Kernel issuer as audience, including its path when present; do not reduce it to an
origin or derive a different audience from a convenient hostname. SDK131 provides
`register.selfIssuer` and `connect({ auth: { resolve } })`; do not invent a signing helper that
the installed SDK does not export. The qualified ES256 proof construction is:

```js
import { importJWK, SignJWT } from 'jose'
import { issuer, jwk, register } from '@astrale-os/sdk/auth'
import { connect } from '@astrale-os/sdk/client/session'

async function selfCredential(kernelIssuer, privateJwk) {
  if (privateJwk.kty !== 'EC' || privateJwk.crv !== 'P-256' || !privateJwk.d) {
    throw new TypeError('Expected the registered ES256 private JWK')
  }
  const publicJwk = jwk.acceptPublic({
    kty: 'EC', crv: 'P-256', x: privateJwk.x, y: privateJwk.y,
  })
  const accountIssuer = await register.selfIssuer(issuer.accept(kernelIssuer), publicJwk)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: privateJwk.kid })
    .setIssuer(accountIssuer).setSubject('self').setAudience(kernelIssuer)
    .setIssuedAt().setExpirationTime('3m')
    .sign(await importJWK(privateJwk, 'ES256'))
}

function openAccountSession(kernelIssuer, privateJwk) {
  return connect({
    url: kernelIssuer,
    auth: {
      ttlSeconds: 60,
      resolve: async () => ({ credential: await selfCredential(kernelIssuer, privateJwk) }),
    },
  })
}
```

Create the session inside the execution and close it in `finally`. Use the SDK's callable
references, or a canonical `Path.parse` for an exact configured target; await `session.call`
before acknowledging success. Give the call a bounded AbortSignal. An HTTP timeout does not prove
that the remote mutation failed, so keep repeat safety in the business operation, not in a blind
retry loop or a generic exactly-once claim.

## Plain deployment

Bundle the plain Worker entry and its runtime dependencies into the module payload. Do not import
private Kernel/adapter implementations or require a Schema, Publication, view or Domain signer
for this compute-only worker. `@astrale-domains/services` supplies the management Schema. Its root
import remains Schema-only; the candidate scaffolder adds a separate executable to the same package.

## Plain Worker starter

Candidate [Domains PR211](https://github.com/astrale-os/domains/pull/211) adds this executable
(not yet a published-release guarantee):

```sh
npm exec --package @astrale-domains/services -- create-astrale-service my-background-job
cd my-background-job
npm install
```

Check that the selected published package actually contains `create-astrale-service` before using
that command. Qualification used the candidate's packed tarball installed outside the workspace,
not an unpublished workspace dependency. Do not imply that existing Services0.4.4 has the binary.

The generated files belong to the consumer; there is no scaffolder runtime or Domain to install:

- `src/job.js`: adapt the protected callable's input; configure exact `KERNEL` and `TARGET` in
  `service.json`. Account creation, registration and group assignment remain business-owned.
- `src/account.js`: a fresh registered ES256 self-account session per execution, closed in `finally`.
- `src/index.js`: health route and private cron handler; awaited call, 9-second budget, bounded logs.
- `npm run deploy -- --instance=INSTANCE --as OWNER`: build and invoke public Services deploy.
  An explicit target is required. Non-ready deployment results fail the command.

Deploy, set `ACCOUNT_PRIVATE_JWK` through the write-only secret API, verify the account's real
business call, then enable the schedule. The generator neither installs dependencies automatically
nor allocates remote resources, credentials or permissions. Redeploy uses the same owner/serviceKey.
An existing destination is left untouched rather than overwritten.

## Transport defaults and scheduling

Plain Services defaults are supplied only when `compatibilityFlags` is omitted. An explicit array,
including `[]`, replaces them. Public same-zone fetch routing uses `global_fetch_strictly_public`.
The SDK Cloudflare adapter already includes it before artifact/digest construction; Services must
preserve the exact flags of revisioned artifacts. Never append flags after digest calculation.

Rollout note (2026-09-08): [Domains PR210](https://github.com/astrale-os/domains/pull/210) adds this
plain-provider default, but an open/merged PR or
published Schema package does not prove the Services Runtime was deployed. Until that deployment
is attested, an explicit plain payload uses
`['nodejs_compat', 'nodejs_compat_populate_process_env', 'global_fetch_strictly_public']`.
This is a deployment setting, not an authentication workaround. Existing Workers need redeployment.

The Services dispatcher, not a native tenant `scheduled()` handler, runs the cron:

| Boundary | Contract |
| --- | --- |
| Schedule management | `CloudflareWorker.setSchedule({crons: [...]})`, five-field UTC expressions |
| Worker entry | Private `POST /__scheduled` handled by `fetch(request, env)` |
| Metadata | `x-astrale-scheduled-time`: epoch milliseconds; `x-astrale-cron`: matched expression |
| Deadline | Current dispatcher waits up to 10 seconds; bound the business call below this budget |
| Public routing | Dispatcher rejects public `/__scheduled`, even with forged headers |
| Disable | `setSchedule({crons: []})`; observe convergence rather than assuming immediate cancellation |

Validate the scheduled timestamp, await the business effect, return a non-success status on failure,
and emit only bounded non-secret correlation fields. Header names are not authentication: the
private dispatch boundary provides isolation. A separately exposed route must not treat possession
of these headers as permission. Do not put the private key or proof in cron metadata.

## Qualification and cleanup

- Verify the exact caller with a real account call, then correlate at least two natural ticks with
  independently observed business state. Do not log arbitrary business results to obtain evidence.
  A manual POST, health200 or a configured schedule is insufficient.
- Check an allowed target and a denied target, then remove relevant permissions and observe the
  next real tick denied without effects. Restore them and observe recovery with the same account.
- Check a missing secret and recovery; an expired/wrong-audience proof must fail without effects.
- Verify a redeploy keeps the intended account, secret and schedule; replay safety belongs to the
  business contract. Distinguish worker elapsed time, scheduling delay and log-ingestion delay.
- Disable the cron, allow bounded convergence and observe empty schedule/no later invocations.
  Delete compute through Services; resume `deleting` at its returned retry interval within a
  bounded cleanup window. Verify provider absence separately from graph absence.
- Delete the dedicated account, memberships, business fixtures and local keys only when that
  cleanup is requested. Preserve shared groups, Domains and instances. For a temporary Domain,
  remove its data before safe uninstall and delete its publishing Service separately.

Use Services logs as the normal observation API. If that API itself fails, record the defect;
provider diagnostics require existing operator authority and must not become a runtime dependency.
Historical qualification found structured-log decoding and warm-route auth error classification
defects ([Domains209](https://github.com/astrale-os/domains/pull/209) /
[Kernel753](https://github.com/astrale-os/kernel/pull/753)); verify their actual deployment before
assuming they are fixed.
