---
name: astrale-domain
description: Create, develop, deploy, and iterate an Astrale domain end-to-end — schema modeling (classes, interfaces, edges, methods), handler implementation, calling the kernel and other domains from handlers, integrating external APIs (the core use case — DI, secrets, idempotency, sagas), views, testing, and the deploy/install loop with the cloudflare or astrale adapter. Use whenever creating a domain, adding classes/methods/views, structuring external API calls, or debugging install/dispatch/permission errors. Pairs with the astrale-cli skill (CLI ops) — together they cover working an Astrale instance autonomously. `npx create-astrale-domain <name>` scaffolds a new domain project.
when_to_use: when asked to create or edit a domain.
---

# Astrale Domain

An Astrale **domain** is a typed contract installed into a kernel's graph plus a
**worker you own** that executes it. The kernel stores the schema (classes,
edges, function contracts), enforces permissions, and routes calls; every
method body runs on YOUR worker (Cloudflare worker or Astrale-managed service).
The graph is the database AND the bus: domains read/write nodes+edges through
the kernel and call each other's functions through it.

**Mental model:** schema = what exists and what's callable · graph = state ·
worker = behavior · kernel = router + authorizer. You never run a database or
an RPC layer; you declare a contract and implement handlers.

## 0 · Start

```bash
npx -y create-astrale-domain@latest my-domain --yes --instance <slug>   # scaffold
              # managed `astrale` adapter is the DEFAULT; `--instance` stamps the
              # target instance into prod (`--adapter cloudflare` = your own CF account)
cd my-domain && pnpm install
pnpm dev      # local wrangler dev (prints a URL; install it on an instance to test)
              # port 8787 taken? dev AUTO-PICKS a free one and prints it —
              # always trust the printed URL, and `curl <url>/meta` must name
              # YOUR domain (an orphan wrangler answers on stolen ports).
pnpm dev --port 8899   # pin a port explicitly (disables auto-pick)
pnpm dev --host https://my-box.preview.dev   # dev behind a tunnel/sandbox preview:
                       # binds 0.0.0.0 + pins WORKER_URL so iss doesn't drift
pnpm prod     # deploy + (astrale adapter) auto-install on your instance
```

Project anatomy (the scaffold is the reference — read its comments):

```
domain.ts           # THE manifest — wires it ALL: defineDomain({ schema, methods,
                    #   deps, views, functions, client }) + origin/postInstall.
                    #   Modules are imported & passed EXPLICITLY (no folder magic);
                    #   a renamed module is a compile error here, not a missing route.
astrale.config.ts   # binds the domain to its deploy adapter (deploy(domain, …)) — node-only
schema/             # classes/interfaces/edges — the contract (zod props, fn signatures)
                    #   + index.ts exports D = compileDomain(schema) (resolved paths/keys)
core/<context>/     # pure, transport-agnostic logic per bounded context (e.g. core/monitor: keys/health/node)
integrations/       # external-API ports + adapters + a lazy registry (see §4) — what deps is built from
runtime/index.ts    # composition root: the methods map; each execute resolves deps → calls core logic
functions/          # standalone remote functions (webhook-shaped endpoints)
views/              # iframe-mountable UI declarations (defineView)
client/             # the SPA served under /ui (vite)
deps.ts             # env → typed Deps container (the seam defineDomain({ deps }) mounts)
env.ts              # typed worker env — config + secrets arrive here, mapped by deps.ts → ctx.deps
```

Iteration loop: edit → `pnpm prod` → call it. Managed redeploys keep the same
service URL and reinstall the contract; schema changes are merge/reconcile
(removed entries can leave old nodes behind — see the astrale-live-domain-edit
skill for graph-level cleanup).

## 1 · Schema modeling

```ts
import { KernelSchema, defineSchema, edgeClass, nodeClass, nodeInterface } from '@astrale-os/kernel-core'
import { CONTACT_OPS_ICON, CONTACT_ICON } from '../icons'
import { fn } from '@astrale-os/kernel-dsl'
import { z } from 'zod'

export const ContactOps = nodeInterface({           // interface = shared contract
  icon: CONTACT_OPS_ICON,
  methods: { createContact: fn({ static: true, params: {...}, returns: ... }) },
})
export const Contact = nodeClass({
  icon: CONTACT_ICON,
  implements: [ContactOps, KernelSchema.interfaces.Container],  // Container → can hold children
  props: { email: z.string(), company: z.string().optional() },
  methods: { assign: fn({ params: { project: z.string(), role: z.string() }, returns: ... }) },
})
export const works_on = edgeClass(                  // edges are CLASSES with PROPS
  { as: 'contact', types: [Contact] },
  { as: 'project', types: [Project] },
  { props: { role: z.string() } },
)
export const schema = defineSchema('my-domain.example.dev', {
  interfaces: { ContactOps },
  classes: { Contact, Project, works_on },  // EDGE classes register under `classes` too
  imports: [KernelSchema],
})
```

Conventions and rules:
- Naming: classes/interfaces `PascalCase`, methods `camelCase`, **edges `snake_case`**.
- `static: true` = called on the class (`/origin/class.X/method`); otherwise
  instance-dispatched (`/path/to/node::method`, handler gets `self`). Statics
  work on classes AND interfaces, wired through the same `method()` /
  `classMethods()` helpers (the scaffold's `seed` is a class-hosted static).
- Model relations as **edges with props** (not foreign-key strings): create via
  `::link {edgeClass, target, props}`, walk via `::getLinks`. Two shapes for a
  child collection — pick by whether the child has independent existence:
  **(a) containment** — give the parent class
  `implements: [KernelSchema.interfaces.Container]` and store children as tree
  nodes under it (`/parent/<childId>`); read them natively via
  `<parent>::listChildren` and they belong to / delete with the parent. This
  works on ANY Container-implementing class, not just `Folder` (the serializer
  emits the `method_of` edge for the implemented interface, so `::listChildren`
  dispatches on the instance) — a plain `nodeClass` instance has NO
  `::listChildren`, so reach for it only on a Container. Use containment when the
  child can't stand alone (a comment in a thread, a line in an order).
  **(b) association** — FLAT nodes + an edge, read via `getLinks` — the
  relation-first default for peer references. (Either way `deleteNode` is
  leaf-only: drain children before deleting the parent.)
- Props are zod; they land in the graph under QUALIFIED keys
  (`origin:class.X.property.y`). Never hand-write key strings — derive them
  from the compiled schema: `D.Contact.email.key`, `K.Named.name.key`.
- Known sharp edges: `::update` currently drops `z.enum()` props silently
  (create is fine — track status as plain string if you must update it); edge
  prop accessors exist at runtime but not in types yet (cast).

## 2 · Handlers

Separate LOGIC from WIRING. Logic = plain async functions in `core/` taking the
kernel client + ports + params (testable with fakes). Wiring = `method()` /
`classMethods()` / `interfaceMethods()` in `runtime/index.ts` (the composition
root — the only place request context + `deps` meet the `core/` logic):

```ts
const kickoff = method(schema, 'Project', 'kickoff', {
  authorize: async () => undefined,   // see §6 for real authorization
  execute: ({ kernel, self, params, deps }) => {
    if (!kernel) throw new Error('kickoff requires a kernel credential')
    return kickoffLogic(kernel, createWeatherClient(deps), self.path.raw, params)
  },
})
```

Handler context: `kernel` (callback client bound to the composed credential —
caller's delegated authority ∪ this function's own), `self` (instance methods),
`params` (zod-validated), `deps` (your typed `Deps` from `deps.ts`; raw `Env` if
you omit the mapper), `auth` (principal, verified claims). Resolve ports from
`deps` per request (`deps.prober()` — the registry builds + caches them per
isolate) — NEVER construct external clients at module load (workers must be
import-side-effect-free).

## 3 · Talking to the kernel (and other domains)

Everything is `kernel.call(path, params)`. Addressing forms:

| Form | Example | Use |
|---|---|---|
| tree path + `::method` | `/projects/apollo::get` | instance dispatch on a node |
| static slash form | `/origin/class.X/method` | static class/interface methods |
| colon MethodPath | `/:origin:class.X:method` | canonical method form |
| colon FunctionPath | `/:origin:function.seed` | a standalone `functions/` callable (what `postInstall: functions.seed` resolves to) |
| `@<uuid>::method` | `@4548…::get` | by graph id (NOT slugs/paths) |

Core ops from handlers (all proven patterns):

```ts
await kernel.call(K.Node.createNode.path.method.raw, { class: D.Contact.path.class.raw, path, props })
await kernel.call(`${path}::update`, { props: { [D.Project.title.key]: 'New' } })
// Edge props use QUALIFIED keys; the edge-prop TYPE accessor is missing today — use this cast:
const ROLE_KEY = (D.works_on as unknown as { role: { key: string } }).role.key
await kernel.call(`${path}::link`, { edgeClass: D.works_on.path.class.raw, target, props: { [ROLE_KEY]: role } })
const links = await kernel.call(`${path}::getLinks`, {})       // filter by edge class
await kernel.call('/other.domain/class.Echo/echo', { message }) // ANOTHER domain's function
```

- **Cross-function calls work** (same- or cross-domain): the kernel redirects
  to the target worker and your worker mints a next-hop delegation as ITSELF —
  the receiver sees your function as the caller, with the original caller's
  authority threaded through the grant chain. Design service-to-service flows
  on this; no direct HTTP between workers.
- Upsert idiom: try `createNode`, on path-conflict fall back to `::update`.
- A missing parent yields `Permission denied: EDIT on /<parent>` — read that
  error as "does the parent exist?" first. Seed required folders in postInstall.

## 4 · External APIs — the core pattern

Almost every real domain wraps an external API (payment, calendar, LLM
gateway, cloud provider). The shape (see admin/domain for the full-scale
example — Scaleway/WorkOS/KV):

1. **Port** — a narrow interface in `integrations/<feature>/port.ts` declaring
   only what the logic needs (`WeatherClient { forecast(city) }`, the scaffold's
   `Prober { probe(url) }`). `core/` logic depends on the port, never
   on fetch/SDKs/env.
2. **Adapter(s) + registry** — `createXClient(config)` in
   `integrations/<feature>/` (one per backend), plus a `registry.ts` that reads
   config + secrets from `env`, validates LOUDLY (`if (!env.X_API_KEY) throw`),
   sets base URLs (overridable so tests point at a stub), timeouts
   (`AbortSignal.timeout`), and maps upstream failures to errors with the
   upstream detail in `cause`. The registry builds the chosen adapter LAZILY +
   caches it per isolate (a worker never validates an unused backend's env).
3. **Wiring** — `deps.ts` mounts the registry (`defineDomain({ deps })`); the
   `execute` hook resolves the PORT from `deps` (`deps.prober()`) per
   request and passes it to the `core/` logic.

Secrets & config:
- Declare every var as a typed field on `Env` in `env.ts`. Secrets ship via
  the adapter's `secrets: '.env.dev' / '.env.prod'` (cloudflare adapter) —
  never committed, never defaulted. Fail fast for root-of-trust values; allow
  multi-name fallbacks only for developer convenience, never silently in prod.
- Both adapters ship secrets from `secrets: '.env.<env>'` — cloudflare via
  wrangler secrets, astrale (managed) via the encrypted per-install store.

Reliability rules (learned from the admin provisioning engine):
- **Order effects**: external call FIRST, graph write AFTER when possible — a
  failed upstream then leaves nothing to clean up. When you must write first
  (reservations), write an INTENT record (state: 'provisioning'), make the
  external call idempotent (tags/external ids so re-entry ADOPTS instead of
  duplicating), and compensate on failure.
- **Sagas for multi-step flows**: ordered phases; record state transitions on
  nodes (`provisioning → ready | failed`); compensation runs best-effort in
  reverse and NEVER throws (each step returns ok/skipped/error). Document
  which phases are safe to re-enter.
- **Idempotency before mutation**: check existing state before writing; design
  re-runs of any handler to converge, not duplicate (postInstall seeds
  especially — they re-run on every reinstall).

Anti-patterns (all observed in production code — don't):
- constructing clients at module load, or monkey-patching `globalThis.fetch`;
- scattering kernel-error message matching — the kernel exposes no stable
  error codes to handlers yet, so when you must match (the PATH_CONFLICT
  upsert), isolate it in ONE helper (the scaffold's `isPathConflict`) and
  treat it as tech debt;
- god persistence files — split graph CRUD by entity;
- leaving state fields mid-transition with no failure path (`'installing'`
  forever after a crash);
- stringly-typed prop keys or class paths (always compiled accessors).

## 5 · Views & standalone functions (webhooks)

- `defineView({ auth, mount: '/ui/contact', viewFor: selfOf(Contact) })` in
  `views/`, collected into the `views` map in `views/index.ts`, which
  `astrale.config.ts` imports and passes to `defineDomain({ views })`. The MAP
  KEY is the view's node slug (`'ui-contact'` → `/<origin>/core/views/ui-contact`).
  Installs a View
  node whose binding URL = `<serving url><mount>` (managed:
  `https://<slug>.svc.<region>.astrale.ai/ui/contact`). The client/ SPA
  serves `/ui/*` — BOTH adapters ship it (cloudflare via Workers Assets;
  managed via the platform's per-version asset archive); the SPA must handle
  any `/ui/<route>` via its fallback (the scaffold's vite config does).
- Discovery: clients/GUIs find a node's views via
  `kernel.call('/kernel.astrale.ai/class.View/resolve', { node: <path> })` →
  `[{ path, url, name, origin }]` — `url` is the mounted iframe target.
- `functions/` declares standalone callables (`defineRemoteFunction`) not
  attached to a class — each serves at `POST <worker>/functions/<slug>` and
  materializes a Function node under `/<origin>/core/functions/`. This is the
  INBOUND integration surface (webhooks). Each also gets an `of_domain` edge, so
  it is addressable by the semantic path `/:<origin>:function.<slug>` (the map
  key is `<slug>`) — which is why a standalone function is the cleanest
  `postInstall` target: reference it directly (`postInstall: functions.seed`) and
  the SDK derives the path, so a domain-bootstrap `seed` need not be bolted onto a
  class and can't drift from a hand-written string.

**The webhook-that-writes pattern** (validated): keep `auth: 'required'` and
configure the external system's auth header with a minted delegation token —
`astrale token --audience <service url> --ttl <seconds> --raw` (use a
dedicated, attenuated identity: grant it only what the webhook needs).
For `auth: 'public'` upstreams that can't carry a header (HMAC-signature
webhooks, Stripe-style): `kernel` is null, but `ctx.selfKernel()` gives a
session authenticated as THE FUNCTION'S OWN identity (its grants only) —
VERIFY THE UPSTREAM SIGNATURE FIRST, then act as yourself. Needs
`deps.INSTANCE_KERNEL_URL` (managed deploys set it) and the function identity
granted exactly what it writes (e.g. EDIT on the target folder + USE on
createNode + USE on the class — narrow, never root).

**A PUBLIC view that reads the graph** (e.g. a server-rendered list page):
the render ctx exposes `ctx.selfKernel()` (sdk ≥0.1.5) — a session as THE
VIEW'S OWN identity. Read with it directly in `render`, template to HTML:
`const k = await ctx.selfKernel(); const rows = await k.call('/messages::listChildren', {})`.
Grant the view's function identity the READ-side minimum in your seed —
the grant call is dispatched ON the identity node, with a bitmask:
```ts
import { READ, USE, toMask } from '@astrale-os/kernel-core'
await kernel.call('/<origin>/core/views/<view-slug>::grantPerm', { node: '/messages', perms: toMask(READ) })
await kernel.call('/<origin>/core/views/<view-slug>::grantPerm', { node: '/:kernel.astrale.ai:interface.Container:listChildren', perms: toMask(USE) })
```
Needs `deps.INSTANCE_KERNEL_URL` — managed deploys set it automatically; on
the cloudflare adapter set it yourself: the instance's kernel API base is
`https://<instance-slug>.eu.astrale.ai/api` (a vars entry or secret).
Public-input
hygiene: HTML-escape every stored string at render. (Prefer `selfKernel`
over the `SELF` service binding for graph reads — `SELF` exists on both
cloudflare and current managed runtimes, but it costs an extra HTTP hop and
older hosts omit it.)

**Calling a remote function over raw HTTP**: the response wraps your return
value in an envelope — `{ result: <your value> }` (errors: `{ error }`).

**Webhook idempotency** (senders retry — design for replays): derive a
DETERMINISTIC node path from the sender's id (`/contacts/lead-<externalId>`),
and make that key BOTH the existence check AND the write target. The classic
bug is checking one key and writing another (random-suffixed) — the replay
then duplicates. Custom `binding` supports REST-ish routes + header/body
capture when the sender's shape is fixed (see distribution's proxy functions).

## 6 · Identity, auth, permissions

- Your worker IS an identity: at install, every callable gets `(iss = serving
  URL, sub = function path)` stamped in the graph; the kernel verifies your
  worker's signatures against your live JWKS. `astrale.config.ts` origin =
  `schema.domain` (aliasing another origin triggers a DANGER prompt).
- Inbound calls carry a delegation of the caller; your handler's `kernel` acts
  with `union(caller's delegated authority, your function's own grants)` —
  attenuation is automatic (you can't exceed what the caller + you hold).
- `authorize` hook: return `undefined` to allow (relying on kernel-level
  checks downstream), or assert claims/perms before `execute` runs.
- Permissions are bitmasks (READ/EDIT/USE/SHARE) on `has_perm` edges; grants
  on a node cascade down the tree. Function identities get USE on
  `mintDelegationCredential` at install (enables cross-function calls).

## 7 · Deploy & install

Adapter choice in `astrale.config.ts` (each adapter is its OWN package — swap
BOTH the import and the call):
- `cloudflare({...})` from `@astrale-os/adapter-cloudflare` — your CF account;
  `dev` (wrangler dev), `prod` (route or workers.dev); ships secrets + SPA
  assets; extra bindings via a deep-merged `wrangler` block.
- `astrale({ dev: {...}, prod: { instance: '<slug>' } })` from
  `@astrale-os/adapter-astrale` — managed (the scaffold's DEFAULT): publishes
  the bundle THROUGH the platform and installs it as a host-local service next
  to your instance (`https://<name>-<hash>.svc.<region>.astrale.ai`). No CF
  account; auth = your `astrale auth login` session. Ships the client SPA
  (`/ui` serves managed) and author secrets (`prod.secrets: '.env.prod'` —
  encrypted at rest platform-side, re-applied on redeploys; omit = keep,
  `{}` = clear; platform keys always win).

The first deploy generates `.astrale/identity.ts` — the domain's SIGNING
IDENTITY (its private key). Losing or regenerating it breaks reinstalls under
the same origin; back it up (or commit it knowingly for throwaway domains).

Dev-loop reality: `pnpm dev` serves on localhost — a REMOTE instance's kernel
cannot fetch its install bundle. Local URL installs only work against a kernel
that can reach you (local kernel, or a tunnel). Against a managed/remote
instance, iterate with `pnpm prod` (the managed loop is ~25s and keeps the
service URL stable).

`postInstall` runs after every install (as __SYSTEM__) and MUST be idempotent
(catch path-conflicts). You never write the origin — it's always this domain.
Prefer a standalone function and reference it directly: `postInstall: functions.seed`
(the SDK derives the path; a rename is a compile error, never a stale string). A
class/interface static method is a member string: `postInstall: 'class.X:seed'`.
Seed folders, defaults, and demo data here.

Manual install of any served domain: `astrale domain install <url> --direct`.

The managed catalog surface (what `pnpm prod` shells into) is callable
directly — useful for recovery and inspection:
`/admin/domains/<name>::install {instanceId, source:{kind:'package'}}` ·
`::uninstall {instanceId}` (the un-wedge recipe before a retry) ·
`::installations` · `::versions` — all on the admin instance (`-i admin`).

## 8 · Testing

- **Logic**: unit-test with fake ports (the DI in §4 exists for this) and a
  fake kernel — an in-memory `{ call(path, params) }` that records calls /
  returns canned nodes. Assert call ORDER and failure paths (best-effort
  flows: one failing step must not block the rest).
- **Wiring/contract**: typecheck is the contract test (`pnpm typecheck` /
  `tsgo --noEmit`); the schema drives param validation at runtime.
- **Live smoke** (always finish with this): deploy, then drive the REAL surface
  with the CLI — create a node, call an instance method, walk an edge, call a
  cross-domain function. Fixture-green alone proves nothing about dispatch,
  identity, or bindings.

## 9 · Debugging quick table

| Symptom | Likely cause |
|---|---|
| any managed-service 500 — `{"error":{"code":5000,"message":"internal error; reference = …"}}` | `astrale logs --service <service-slug>` tails the service's runtime buffer (console output, 5xx accesses, uncaught exception stacks) — the slug is the first label of the `…svc.<region>.astrale.ai` URL `pnpm prod` printed. Services deployed before log capture need one redeploy first. |
| `Permission denied: EDIT on /x (param-target)` | `/x` doesn't exist — seed the parent |
| `method "x" not found … call it as "/:o:class.C/x"` | instance form used for a static method |
| `Delegation mint failed for <url>` | check `--debug` cause chain; worker→worker call machinery |
| postInstall `not a function or method member` | wrote a full path/tree path — use `functions.seed` (a reference) or a member string `'class.X:seed'` |
| install: `missing remote binding` | a callable lacks `binding.remoteUrl` — build via the adapter, not hand-rolled specs |
| `ERR_PNPM_IGNORED_BUILDS` / approve-builds on `pnpm run` | template's pnpm-workspace.yaml needs `ignoredBuiltDependencies` + `verifyDepsBeforeRun: false` (recent scaffolds have it) |
| stale/broken package versions on scaffold | clear pnpm metadata cache; check template floors are current |
| TS: "Types of property '__brand' are incompatible" in untouched files | TWO copies of kernel-core/dsl in the tree (mixed link:/registry/override resolution) — unify versions, then `pnpm dedupe` |
| runtime 500: `MISSING_DEF: Def at path "…" is not registered` | SAME dual-copy disease at runtime (defineSchema wrote copy A, compile read copy B) — and on managed installs it presents as the service never turning ready / install stuck `installing`. Unify + dedupe. |
| managed install stuck at `installing` | check the SERVICE first: `curl <svc>/meta` (500 = the bundle itself is broken — run it locally with wrangler to see the real error); then `…::uninstall {instanceId}` and re-run the install |
| `Path not found: /admin/instances/<uuid>` on install | `instanceId` takes the instance SLUG, not the node UUID (`astrale instance status <slug>` shows both) |
| deploy: `Export named 'X' not found` from an @astrale-os module | a transitive dep resolved below its REAL floor — `pnpm add @astrale-os/<pkg>@<needed>` then `pnpm dedupe` |

Use `astrale call <path> --describe` for any callable's schema, `--debug` for
the full error chain, `curl <worker>/meta` for what a worker serves
(domainName, schemaHash), and `astrale logs --service <slug> [--tail N]` for a
managed service's runtime logs.

## Related skills
- **astrale-cli** — every CLI command (auth, instances, calls, install).
- **astrale-live-domain-edit** — graph-level schema surgery on a live kernel
  (no worker changes): temp specs, reinstall semantics, minimum class/method
  graph material.
