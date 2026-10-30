# Scheduled Worker calling an installed Domain

Use a plain Worker for a background job calling an existing Domain. Scaffold and deploy it as
[workflows.md](workflows.md) describes; it needs no Schema, Publication, or consumer installation.

## Separate compute from business authority

| Owner | Responsibility |
| --- | --- |
| Services `CloudflareService` / `CloudflareDeployment` | Compute, deployment routing, Service crons, write-only secrets |
| Business Domain's account Identity | The job's authenticated identity and business permissions |
| Target consumer Kernel | Installed callable and its policy enforcement |

Deploying a Worker does not create/register its business account or grant permissions. Deleting
compute does not delete that account. The deployer's Admin identity and the job's account on its
target Kernel are independent choices.

The first deploy of `(project, environment)` creates a Service owned by the deployer unless an
admitted owner is specified. Subsequent deploys require `OwnService`; the address is not unique per
owner. A group owner is supported through `extends_with`, granting members management rights,
including deletion. See [schema.md](schema.md).

## Prepare the account and job

1. Create the dedicated account through its business Domain, retaining the returned Node ID.
   If Shell membership is required, use a supported User/concrete account type and inspect the
   installed membership contract. A bare Kernel Identity is not automatically a Shell member.
2. Generate a dedicated key and register it on that existing account through an authorized caller:

   ```sh
   astrale identity create background-job
   astrale identity register background-job --node @ACCOUNT_NODE -i INSTANCE --as REGISTRAR
   ```

   Use `--via` when the owning Domain supplies registration authority. Registration must return
   that exact Node; retry registration without inventing another account or key.
3. Grant only the job's required authority through the Domain/Shell's supported operations.
   `Group.assignMember` maintains membership and `extends_with`; do not replace it with a partial
   graph edge write. Registration alone grants no callable or business rights.
4. In the generated `service.json`, set exact `KERNEL` and `TARGET`, declare
   `ACCOUNT_PRIVATE_JWK`, and leave `crons: []`. Supply the private JWK through the environment's
   secret source. `astrale identity export background-job <private-path>` writes an identity
   envelope; supply its `privateJwk` object serialized as JSON as `ACCOUNT_PRIVATE_JWK`, not the
   complete envelope. Keep the export and extracted value in protected files or your secret
   manager, never terminal output. Do not put it in source, argv, graph properties, or logs.
5. Adapt `src/job.js` to real input and repeat-safe business behavior. The scaffold opens an ES256
   self-account session for one execution and closes it in `finally`; keep that lifecycle and
   bound the business call below the dispatch deadline.

The self proof's audience is the exact Kernel issuer, including its path. Use the SDK primitives
imported by the scaffold (`register.selfIssuer`, `issuer`, `jwk`, `connect`) rather than a guessed
signing API. The generated session (`connect` with `auth`) exchanges the account's credential at
a hosted callable's declaring Domain, which then acts for the account: the callable's Policy
decides for the account, and the declaring Domain needs no scope for its own callable. A Kernel
syscall such as Query or Mutation receives the account itself and admits it only as a member of
that syscall's Kernel Role (`graph.reader`, `graph.writer`); see
[Policies](../../astrale-domain/references/policies.md).

The scaffold exports `openAccount`. Keep its `connect` defaults; `exchange: { mode: 'source' }`
presents the account itself instead, and the same Policy decides. Either way, verify the actual
callable and business authorization under the account before scheduling.

## Deploy and verify before scheduling

Use the 0.8.2-or-newer compatible scaffolder and its pinned packages, then
`npm run deploy -- <environment> [--admin <bookmark>] [--as <identity>]` from the generated project.
This uses `@astrale-os/adapter-astrale/services`; the old `--instance` and owner-scoped `serviceKey`
workflow does not apply. `--no-promote` deploys a candidate without changing current routing/crons.

Verify the job's real callable under its actual account before enabling cron. `/health` proves
readiness of the Worker version, not authorization or a successful business effect. After that
verification, enable the schedule in `service.json.crons` and redeploy: promoting scaffold deploys
replace the complete cron set from that file, overriding a manually configured schedule. Keep a
privileged manual test endpoint private and explicitly authorized if the implementation needs one;
the public scheduling endpoint is intentionally unavailable.

The published 0.8.2 scaffold defaults to `compatibilityFlags: ["nodejs_compat"]`; that is not
a guarantee that same-zone Worker fetches reach the intended Kernel. For global `fetch()` calls
to Worker routes in the same Cloudflare zone, add `global_fetch_strictly_public` to `service.json`
before deployment so requests use public routing instead of bypassing Workers. See
[Cloudflare's routing contract](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public).
Verify the job reaches its real Kernel and business callable before enabling cron.
Compatibility flags are part of the frozen configuration. Preserve the generated/pinned runtime
settings or deliberately change them before the adapter computes the label; do not graft historical
plain-payload defaults onto an already-built deployment.

## Private scheduling boundary

| Boundary | Contract |
| --- | --- |
| Management | `CloudflareService.setSchedule({crons:[...]})` replaces the complete set; up to 24 five-field UTC expressions |
| Target | Service's current deployment; promotion moves subsequent runs to the promoted release |
| Entry | `fetch` handles private `POST /__scheduled`, not a native tenant `scheduled()` handler |
| Metadata | `x-astrale-cron` and `x-astrale-scheduled-time` (epoch milliseconds) |
| Budget | Dispatcher deadline is 10 seconds; generated job uses a smaller bounded call budget |
| Public access | Dispatcher rejects public `/__scheduled`, including alternate spellings and forged headers |
| Disable | `setSchedule({crons:[]})`; verify convergence and allow already-running work to finish |

The dispatcher checks due expressions each minute; execution is not exactly-once. Validate metadata,
await the business effect, return a non-success status on failure, and keep repeat safety in the
business operation. A timeout is not proof that a remote mutation failed. Headers alone are not
authentication; the dispatcher provides the private boundary. Do not expose another route that
trusts their presence as authorization.

After configuring a cron, correlate natural ticks with independently observed business state and
bounded logs. A configured schedule or manual invocation alone is insufficient. For requested
permission/recovery qualification, use dedicated fixtures to verify denied calls cause no effect,
then restore the intended access and observe recovery. Do not remove real users' permissions to test
this. Update the source of secret values as well as a current deployment's rotated secret, and
verify which release is current when checking redeploy/rollback behavior.

## Cleanup

Disable the Service's schedule first when cleanup is requested, observe cessation after bounded
convergence, then retire the selected deployment or delete the Service using the returned retry
intervals. A candidate's retirement and a Service's deletion are different operations. Verify the
exact target's withdrawal; do not infer provider absence merely from a missing graph row.

Account deletion, local key removal, membership cleanup, and consumer Domain uninstall are separate
business operations, performed only within the requested cleanup scope. Preserve shared groups,
Domains, and instances. Use Services logs normally; provider diagnostics require existing operator
authority and must not become a hidden dependency of the job.
