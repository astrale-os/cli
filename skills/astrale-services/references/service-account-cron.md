# Scheduled Worker calling an installed Domain

A plain Worker, scaffolded and deployed as in [workflows.md](workflows.md): no Schema, Publication
or consumer installation.

## Compute versus business authority

| Owner | Responsibility |
| --- | --- |
| Services `CloudflareService` / `CloudflareDeployment` | Compute, routing, Service crons, write-only secrets |
| The business Domain's account Identity | The job's authenticated identity and business permissions |
| The target consumer Kernel | The installed callable and its Policy |

- Deploying a Worker creates, registers and grants no business account; deleting compute deletes
  none. The deployer's Admin identity and the job's account are independent.
- The first deploy of `(project, environment)` makes the deployer the owner unless an admitted
  owner is named; later deploys need `OwnService` (the address is not unique per owner). A group
  owner works through `extends_with`: its members manage the Service, deletion included
  ([schema.md](schema.md)).

## Prepare the account and job

1. Create the dedicated account through its business Domain and keep the returned Node id. For
   Shell membership, use a supported User or concrete account type and inspect the installed
   membership contract: a bare Kernel Identity is not a Shell member.
2. Generate a dedicated key and register it on that existing account through an authorized caller
   (`--via` when the owning Domain supplies registration authority). Registration must return that
   exact Node; on failure retry registration, never invent another account or key.

   ```sh
   astrale identity create background-job
   astrale identity register background-job --node @ACCOUNT_NODE -i INSTANCE --as REGISTRAR
   ```

3. Grant only the job's required authority through the Domain's or Shell's operations.
   Registration grants nothing. `Group.assignMember` maintains membership and `extends_with`; never
   replace it with a partial Edge write.
4. `service.json`: exact `KERNEL` and `TARGET`, the secret name `ACCOUNT_PRIVATE_JWK`, `crons: []`.
   `astrale identity export background-job <private-path>` writes an identity envelope; the secret
   value is its `privateJwk` object serialized as JSON, not the envelope. Keep both in protected
   files or a secret manager: never terminal output, source, argv, graph Properties or logs.
5. Adapt `src/job.js` to the real input and to repeat-safe business behavior. Keep the scaffold's
   lifecycle: `openAccount` opens an ES256 self-signed session per run and closes it in `finally`.
   Bound the business call below the dispatch deadline.

Session semantics (the scaffold's `openAccount`, built on `register.selfIssuer`, `issuer`, `jwk`,
`connect`; never a guessed signing API):

- The self proof's audience is the exact Kernel issuer, path included.
- `connect` with `auth` exchanges the account's credential at a hosted callable's declaring
  Domain: that Domain is the executor, the account the caller. The callable's Policy decides the
  account; the declaring Domain needs no scope for its own callable.
- A Kernel syscall (Query, Mutation) receives the account itself and admits it only as a member of
  the syscall's Kernel Role (`graph.reader`, `graph.writer`)
  ([Policies](../../astrale-domain/references/policies.md)).
- `exchange: { mode: 'source' }` presents the account itself on every call; the same Policy
  decides. Either way, verify the actual callable under the account before scheduling.

## Deploy and verify before scheduling

`npm run deploy -- <environment> [--admin <bookmark>] [--as <identity>] [--no-promote]` from the
generated project (`@astrale-os/adapter-astrale/services`; the `--instance` flag and owner-scoped
`serviceKey` do not apply).

- `/health` proves the Worker version is ready, not authorization or a business effect. Verify the
  job's real callable under its account, then enable `service.json.crons` and redeploy: a
  promoting deploy replaces the whole cron set from that file.
- A manual test endpoint stays private and explicitly authorized; there is no public scheduling
  endpoint.
- The scaffold's `compatibilityFlags: ["nodejs_compat"]` does not guarantee that same-zone Worker
  fetches reach the Kernel. For a global `fetch()` to a Worker route in the same Cloudflare zone,
  add `global_fetch_strictly_public` before deploying
  ([Cloudflare](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)).
- Compatibility flags are frozen configuration: change them before the adapter computes the label,
  never graft them onto a built deployment.

## Private scheduling boundary

| Boundary | Contract |
| --- | --- |
| Management | `setSchedule({crons})` replaces the whole set; at most 24 five-field UTC expressions |
| Target | The Service's current deployment; promotion moves later runs to the promoted release |
| Entry | `fetch` handles private `POST /__scheduled`; no native `scheduled()` handler |
| Metadata | `x-astrale-cron`, `x-astrale-scheduled-time` (epoch ms, not rounded to the minute) |
| Budget | The dispatcher's deadline is 10 s; the generated job uses a smaller call budget |
| Public access | The dispatcher refuses public `/__scheduled` in every spelling, forged headers included |
| Disable | `setSchedule({crons:[]})`; verify convergence and let running work finish |

- The dispatcher checks due expressions each minute; delivery is not exactly-once. Validate the
  metadata, await the business effect, answer non-success on failure, and keep repeat safety in the
  business operation. A timeout does not prove a remote Mutation failed.
- The headers are not authentication; the dispatcher is the private boundary. No other route may
  trust their presence.
- Prove a cron by correlating natural ticks with independently observed business state and bounded
  logs; a configured schedule or a manual invocation is insufficient.
- Permission and recovery qualification, when requested: dedicated fixtures prove a denied call has
  no effect, then access is restored and recovery observed. Never remove real users' permissions.
- After rotating a current deployment's secret, update the source of future deploy values too;
  check which release is current when testing redeploy or rollback.

## Cleanup

1. Disable the schedule and observe cessation after bounded convergence.
2. Retire the selected deployment or delete the Service, following the returned retry intervals.
   They are different operations. Verify the exact target's withdrawal; a missing graph row does
   not prove provider absence.

Account deletion, key removal, membership cleanup and consumer Domain uninstall are separate
business operations, only within the requested scope. Preserve shared groups, Domains and
instances. Provider diagnostics need existing operator authority and never become a dependency of
the job.
