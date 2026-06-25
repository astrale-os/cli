---
name: astrale-domain
description: "Author Astrale domains end to end. Use when creating, editing, reviewing, productionizing, migrating, optimizing, securing, simulating, or debugging a domain; modeling schema; implementing handlers/functions; integrating external APIs; choosing native Astrale domains; designing views; or reasoning about permissions, delegation, kernel, seeds, core data, sample data, and live/runtime drift. Read the relevant reference for the current intent: development, modeling, implementing, integrations, domains, security, views, migration, performance, simulating, or debugging."
---

# Astrale Domain

## Operating Rules

- Treat the graph as the source of truth. A domain models meaning with schema, stores state as nodes and edges, and exposes behavior as typed functions.
- Prefer workflow questions, guidelines, anti-patterns, and load-bearing advanced concepts over basic ontology. Basic concepts should be inferable from stronger authoring topics.
- Do not trust installed/runtime state from source edits alone. For live bugs, prove what version is deployed and installed, which path is called, and which identity is acting.
- Keep worker code import-side-effect-free. Build outside clients through deps, pass ports into logic, and write durable state to the graph.
- When API behavior could have drifted, read the current repo or scaffold before copying syntax.

## Intent Router

Pick the reference by the user's intent. Do not load every file preemptively.

- Draft, POC, create, deploy, install, or test a domain: read `references/development.md`.
- Touch schema, vocabulary, properties, class/interface/edge choices, or review a schema: read `references/modeling.md` first. Always read it for schema work.
- Implement handlers, remote functions, kernel calls, graph reads/writes, or cross-domain calls: read `references/implementing.md`.
- Wrap an external API, build deps/ports, receive webhooks, or design side-effect/retry behavior: read `references/integrations.md`.
- Decide whether to reuse/import a native Astrale domain instead of modeling a capability yourself: read `references/domains.md`.
- Secure a domain, function, view, client call, public endpoint, grant, delegation, permission, authentication, or authorization hook: read `references/security.md`.
- Build or review browser views, mounted UI, view auth, view resolution, or frontend design: read `references/views.md`.
- Evolve an installed schema, write a migration, decide seed vs core, or handle reinstall/backfill behavior: read `references/migration.md`.
- Optimize graph access, reduce round trips, choose indexes/queries, or review call patterns for latency: read `references/performance.md`.
- Create fake/sample/demo data, testing, fixtures, demo flows, or smoke-test scenarios: read `references/simulating.md`.
- Diagnose a failing live domain: read `references/debugging.md`; start symptom-first and verify installed/runtime state before source-level theory.

## Default Stage Loop

Use this as the default execution shape when the user asks for end-to-end work.

1. Clarify the intent: draft/POC, create, edit, review, productionize, migrate, optimize, secure, view, integrate, choose native domains, simulate, or debug.
2. Load exactly the matching reference above, plus `modeling.md` for any schema change.
3. Inspect the current repo/scaffold before trusting command or API syntax.
4. Make the smallest graph-native change that solves the intent.
5. Verify locally with typecheck/tests when possible.
6. For live behavior, prove deploy/install/runtime state with concrete calls, not source inspection alone.

## High-Signal Workflow Questions

These are the questions most often needed without another reference loaded. They carry the basic model implicitly and point to the work that actually changes a domain.

### How to create a Domain?

You create a domain by scaffolding a project and growing it from a skeleton that already builds and runs. The generator
lays down the folders, the wiring, and a deploy config, so you begin from a working domain rather than a blank file.
From there the work is your own: declare the slice of the world you are modeling, and write the handlers that make it
act.

### How to deploy a Domain?

Deploying a domain ships its worker to a live URL, where it serves the domain's definition and handlers. Run
`astrale-domain deploy <env>` (or `pnpm prod`); the deploy adapter builds the worker bundle, uploads it, and returns the
address it now answers on. Deploying does not put the domain into any kernel instance; it only makes the code reachable,
which installing then mounts.

### How to install a Domain?

Installing a domain mounts a deployed domain into one kernel instance, teaching it everything that domain can hold and
do. Run `astrale domain install <origin-or-url> -i <instance>`; the kernel fetches the domain's signed bundle, verifies
it, writes its schema and core data into the graph, then runs its seed once. After install, the domain's classes exist
and its functions are callable on that instance.

### What to do after modeling a Domain?

Once the schema is in place, you make it run. Write a handler for every function your classes declare, resolve any
external clients through `deps`, then deploy the worker and install it onto an instance. Modeling says what can exist;
these steps make it hold real data and answer calls.

### How to evolve a domain's schema?

You evolve a domain's schema by changing it and installing again: a re-install diffs the new schema against what the
graph already holds and reconciles the difference. The kernel updates the shape, but it does not migrate your existing
data, so a seed or a one-off migration is where you backfill new properties or move old ones. Add fields freely; rename
or remove with care, because data shaped the old way is still there.

### How to test a domain?

You test a domain by installing it into a throwaway in-process kernel and calling its functions as a real client would.
The harness gives you a fresh graph with your schema and handlers loaded and a system identity for setup, so you
exercise real dispatch end to end rather than mocked pieces. Act as a specific identity with chosen grants to confirm
permissions behave as you intend.

### How to define a Function?

You define a function by declaring its typed shape, then writing its handler separately. For a method on a class,
declare it with `fn` inside the class's `methods` (mark it `static` when it needs no node to act on); for a standalone
domain-level callable, use `defineRemoteFunction`. The declaration fixes the params and return type; the handler
supplies the behavior.

### How to integrate an external API?

You integrate an external API by wrapping it behind your own functions, so the outside service appears to the rest of
Astrale as ordinary calls on your domain. Write to the graph first and treat it as the source of truth, then make the
external call; keep each handler idempotent so a retry converges instead of duplicating (see the saga pattern for
multi-step flows). The graph holds the state; the external API is a detail your functions hide.

## Modeling Questions And Guidelines

Use these to choose the graph shape. A strong relationship/property/boundary decision makes the basic node/class/edge model obvious without restating it.

### How to decide a domain's boundaries?

Draw a domain's boundary around one coherent vocabulary: the classes and actions that belong to a single area of the
world and are owned by a single purpose or team. Split into two domains when the language diverges (the same word means
different things) or when ownership does. Keep together what changes together, and let separate domains call each other
rather than merging.

### Model the world, not the storage

Name your classes after the real things your domain is about, like `Contact`, `Invoice`, or `Shipment`, not after
database tables, DTOs, or technical roles. A schema that reads like the business is one anyone can navigate and an agent
can reason over; one that reads like a storage layer (see technical names) hides what it means. The graph is your model
of the world, so let it look like the world.

### How to model a relationship?

Model a relationship as a typed edge between two nodes, giving the edge any properties the relationship itself carries
(such as a `role`). When the related thing cannot exist on its own, make it a child node under a Core folder instead, so
it lives and dies with its parent. Never model a relationship as a foreign-key string buried in a node; an edge keeps it
visible and walkable both ways.

### Edge or child node?

Use a typed edge when two things exist on their own and you are relating them: a contact `works_on` a project. Use a
child node when one thing exists only as part of another and should die with it: a comment under a post, a line item
under an invoice. Ask whether the thing has a life of its own; if yes, link to it, and if no, nest it inside (see
modeling a relationship).

### Should a fact live on an edge?

Put a property on an edge when the fact is about the relationship itself, not about either node it joins: the `role`
someone holds on a project, the date a membership began, the weight of a link. If the fact would be the same no matter
what the node connects to, it belongs on the node instead. Ask what the fact describes; if it describes the connection,
it lives on the edge.

### Its own node, or just a property?

Make something its own node when it has identity and a life of its own, something you want to find, link to, permission,
or hang data on: a `Company`, a `Tag` others reuse. Keep it a property when it is just a value describing one node and
means nothing apart from it: an email, a status. If two nodes could ever point at the same one, it is a node; if it only
ever belongs to one, it is a property.

### When to use a Class vs an Interface?

Use a class when real instances of the thing exist and need to be created, named, and stored. Use an interface when a
contract (some properties or methods) is shared across several kinds but is never a thing on its own. If you are about
to copy the same fields onto two classes, reach for an interface; if you need to point at one concrete record, reach for
a class.

### Depend on a domain, don't copy it

When your domain needs what another already models, depend on it: declare it in requires and call its functions or read
its nodes from the shared graph. Do not re-declare its classes or duplicate its data into your own schema, which forks
the truth and lets the two drift apart. One domain owns each slice of the world; everyone else builds on it by
reference.

### Ship fixed reference data as core

When a domain always needs the same fixed data present (a list of supported currencies, a default catalog), declare it
as core rather than creating it in a seed. Core is materialized at every install with no code to run, sits at stable
known paths your handlers can depend on, and cannot drift between installs. Reserve a seed for setup that needs real
logic.

### Core vs Seed

Core and Seed both put data in place at install, but in opposite ways. Core is declarative: genesis nodes baked into the
install bundle and materialized by the kernel with no callback to your worker, the fixed data a domain always has. Seed
is imperative: a function that runs once after install and builds things step by step (folders, demo data, grants).
Reach for Core for stable reference data with known paths, and Seed when setup needs real logic.

### Static method vs Instance method

An **instance** method runs on one particular node, the `self` it acts on, like assigning a role to a specific contact.
A **static** method belongs to the class itself and runs without any node, like creating a brand-new contact. You
address an instance method with `::` on a node, and a static through its class.

## Load-Bearing Concepts

Keep only concepts that unlock several other ideas. These are worth loading because an agent can infer many lower-level facts from them.

### Domain Definition

A **Domain Definition** is the single object that wires a domain together: its schema, the handlers that implement its
methods, its `deps`, its views, and its standalone functions. You build it with `defineDomain`, and the deployed worker
sees only this one wired object, so your folder layout stays invisible to it. It is the place every part of a domain
meets, declared once and explicitly.

### Requires

**requires** is how a domain declares the other domains it cannot work without. Listing another domain's origin tells
the kernel to refuse installation until that dependency is already present, so your handlers can safely call across to
it and build on its classes. It turns an implicit assumption into a checked guarantee: what you depend on is there
before you run.

### Publish vs Deploy vs Install

**Deploying** ships a domain's worker to a live URL; **publishing** registers that URL in a catalog so instances can
find it; **installing** mounts it onto one kernel instance. Three separate steps: deploy makes the code reachable,
publish makes it discoverable, install makes it part of an instance's graph. You can install straight from a URL and
skip publishing; you cannot install what was never deployed.

### Origin vs Serving URL

A domain's **origin** is its name in the graph, the slug its paths are addressed under, like `crm.acme.dev`. Its
**serving URL** is where the worker actually lives and signs from, the issuer the kernel verifies against. The two are
deliberately separate: you can move a domain to a new URL without renaming everything that addresses it, because
identity is pinned to where it is served, not to what it is called.

### Qualified Properties

A **Qualified Property** key is the fully-spelled name of a property, carrying the domain origin, the owning class, and
the field, like `crm.acme.dev:class.Contact.property.email`. The graph stores properties under these keys, so two
domains can each have an `email` field without colliding. You almost never type them by hand: a typed accessor like
`D.Contact.email.key` compiles to the qualified string for you.

### Reference

A **Reference** is a property or return value that points at another node by its identity, rather than copying its data.
You declare one with `ref(SomeClass)`, or `ref(SELF)` to point at another node of the same class, and the value travels
as a stable handle the caller can resolve. Use a reference when a function should hand back which node it means, not a
snapshot that goes stale.

### Function Handler

A **Handler** is the code that runs when a function is called: the implementation behind a declared method. It receives
a typed context holding the call's `params`, the acting identity as `auth`, the resolved deps, a bound `kernel` for
calling back, and, for an instance method, the `self` node it acts on. Handlers live in `runtime/`, apart from the
schema that declares the method, so the declaration fixes the shape and the handler supplies the behavior.

### Deps

**Deps** is a domain's dependency container: a typed object of the external clients and ports its handlers need, such as
an HTTP client or a payment SDK. You build it with a `deps(env)` function that runs once when the worker starts, and
every handler then reads what it needs from it. Building clients here rather than at module load keeps the worker
side-effect-free and each service swappable behind a port (see integrating an external API).

### selfKernel

**selfKernel** lets a handler act as its own identity rather than the caller's. A function reaches for it when there is
no caller to borrow authority from, like a webhook arriving from the outside world, or when it deliberately needs to do
something the caller could not. Where the ordinary session carries who called, this one carries the function itself.

### Function Identity

A **Function Identity** is the fact that a function is itself an identity: it can be the principal of a call and can
hold its own grants. At install, every callable is stamped with an identity (`iss` is its serving URL, `sub` is its
path) and the kernel verifies its signatures against that issuer's keys. This lets a function act on its own behalf,
with authority that never exceeds both the caller's and its own.

### Grants combine by intersection, not union

When a function acts for a caller, the authority of the call is the **intersection** of the caller's grants and the
function's own, not the union. Routing through something more privileged cannot lift you above your own rights, and
calling a function cannot exceed what that function holds either. This least-privilege rule (see identity composition)
is why crossing into a function is always safe: authority only ever narrows.

### Syscall

A **Syscall** is a built-in function the kernel itself exposes: a primitive operation on the graph such as creating a
node, linking two nodes, or granting a permission. Domains build on these; a domain function usually does its work by
making syscalls. They are declared on the kernel's own classes (`Node`, `Container`, `Identity`) and addressed like any
other call.

### kernel.call vs callRemote

Use `kernel.call` for anything on the same kernel: syscalls and other methods of domains installed alongside yours. Use
callRemote when the target lives on a different worker, because that hop needs a credential minted for the other
worker's audience. Same kernel, plain call; another worker, callRemote.

## Implementation Guidelines And Patterns

Keep implementation boundaries boring: schema declares meaning, the domain definition wires parts explicitly, deps owns external clients, handlers mutate the graph through typed calls.

### Use typed keys and paths

Always derive property keys and class paths from the compiled schema, never hand-write the qualified strings. A typed
accessor like `D.Contact.email.key` stays correct when you rename a field, because a wrong name becomes a compile error
instead of a silent miss at runtime. Treat a raw key string as a smell.

### Build clients in deps, not at import

Construct every external client (an HTTP SDK, a database driver, a payment library) inside your deps function, and read
it from the context in each handler. Building at module load or reaching for a global breaks the worker model: setup
must be side-effect-free, and a client made once at import outlives the request it was meant for (see why not at load).
Deps is the one seam where the outside world is wired in.

### Write the graph first, then call out

When a handler touches an external service, record your intent in the graph before or around the outside call, and treat
the graph as the source of truth. If the external call fails or the worker crashes, the graph still shows what was meant
to happen, so retrying the call later can converge on the finished job instead of losing the work. The outside world is
a detail your handler reconciles toward, not where your state lives.

### Idempotency before mutation

Check existing state before writing; design every handler (especially postInstall seeds) to converge on re-run, not
duplicate.

### A status field for in-flight work

For any operation that is not instant, give the node a status property and move it through explicit states: `pending`
when work starts, `ready` on success, `error` on failure. The state lives in the graph, so a crash leaves a node you can
find and finish rather than work lost in the air. Pair it with an idempotent handler so re-running a stuck operation
converges.

### Saga for multi-step flows

The Graph is the source of truth. Prefer to write first in the Graph, then make external calls. if it takes some time;
then you can set a status: "creating/provisioning" and then update the status to "ready" when the external call is done
or rollback on failure. make your function idempotent.

### Let typed params validate the input

Declare a function's inputs as a typed schema and trust them inside the handler: the kernel validates every call against
that schema before your code runs, so a bad payload is turned away at the door. Re-checking the same things by hand
duplicates what the contract already guarantees. Put the real constraints in the params (a positive number, a valid
email), the same discipline as requiring what is required, and let the handler assume they hold.

### Create with a static method

Make the method that creates a new node a static one, declared on the class rather than on an instance. There is no node
to act on yet when you are making one, so an instance method would have no `self` to receive; a static `create` on the
`Contact` class is the natural home. Use instance methods to act on a node that already exists, and statics to bring one
into being.

### Return a reference, not a snapshot

When a function returns which node it created or found, return a typed reference rather than copying that node's
properties into a bespoke object. A ref is a node identity the caller can resolve with a later graph read when it needs
current state, not an automatically hydrated object. Return plain data when the function means a snapshot, projection,
or computed result.

## Red Flags

Treat these as design smells during review. Most downstream bugs come from one of these shortcuts.

### Do NOT use technical semantics for Modules

Naming your modules after technical layers, like `models`, `controllers`, or `utils`, hides what the domain is actually
about. Group classes by the part of the real world they describe instead, such as `Billing` or `Scheduling`. A good
schema reads like the business it models, not like the folders of a codebase.

### Misplaced properties

A property should live on the thing it actually describes. A fact about how two nodes relate belongs on the edge, not on
one of the nodes; a fact shared by many kinds belongs on the interface they share, not copied onto each class. Misplaced
properties duplicate data and blur what each thing really is.

### A reference buried as a string

Storing another node's id or path as a plain string property hides a real relationship inside an opaque field. The
kernel cannot follow it, the graph UI cannot draw it, and nothing stops it from pointing at something deleted. Model the
connection as a typed edge (see modeling a relationship), so it is walkable from both ends and the schema knows it
exists.

### The god class

Piling every field onto one giant class, a `Thing` with thirty optional props, throws away the very structure the schema
exists to capture. Different kinds of thing deserve different classes with the shape each actually has; what they share
belongs on an interface, not on a catch-all. If half a class's properties are empty on any given node, you have two
kinds wearing one name.

### Making everything optional

Marking every property optional throws away the schema's main job: turning bad data away at the door. If `email` is
optional on a `Contact` that cannot exist without one, the graph will hold a contact with no email, and every handler
then has to re-check what the schema should have guaranteed. Require what is truly required, so a node that exists is a
node you can trust.

### One domain that models everything

Cramming unrelated areas of the world into a single domain, billing and scheduling and chat all under one origin, makes
a blob no one owns and nothing can reuse. A domain should cover one coherent slice with one vocabulary (see drawing
boundaries); when its classes stop sharing a subject, it wants splitting. Smaller domains that depend on each other beat
one that tries to be all of them.

### Keeping state in the handler

A handler keeps no state of its own between calls: the worker may run on a fresh instance each time, so anything stashed
in a module variable or in memory is gone by the next request. Treat the graph as the only place state lives, and read
and write it through the kernel. A counter held in a local variable is a bug; the same counter on a node is the truth.

### Secrets in the graph

Never store an API key, password, or token as a node property. The graph is shared by every domain on the instance and
readable by anyone you grant access, so a secret written there is a secret leaked. Keep secrets in the worker's
environment and reach them through deps; the graph holds your model, never your credentials.

### Trusting a webhook you didn't verify

A public function has no Astrale credential to vouch for its caller, so anyone on the internet can hit it. Acting on its
input without first verifying the sender's own signature lets a stranger forge events into your graph. Verify the
upstream signature before doing anything (see the webhook pattern); a public endpoint that trusts its body is an open
door.

### Handing out SHARE freely

Granting `SHARE` is granting the power to grant: whoever holds it can pass rights to others, who may in turn hold SHARE
and pass them further, so access spreads down a chain you stop seeing (see sharing access). Give SHARE only to those you
trust to manage access themselves. When a recipient just needs to use a thing, grant plain READ or USE, not the right to
re-share it.

### Walking children one by one

Fetching a folder's children and then making a separate call per child to read each one turns a single logical read into
dozens of round trips. `listChildren` already returns the child nodes with their data, so use what it gives you instead
of re-fetching each by path. When you find yourself calling `get` inside a loop over children, you have an N-plus-one.

### Nesting too deep

Burying nodes many levels deep (`/org/regions/emea/teams/sales/members/ada`) makes paths long and brittle, and
permission coarse: a grant high up sweeps in everything below, one low down reaches almost nothing. Depth should reflect
real containment, not stand in for a filing system. When the tree gets deep just to organize, prefer a flatter structure
linked by edges.

### A mutable value as the key

Using a value that can change, like an email or a name, as a node's slug or the key others address it by ties every
reference to a fact that may not hold tomorrow. Rename the contact and `/contacts/ada@old.com` breaks, along with every
grant and edge that named it. Address by a stable id or a slug that encodes nothing mutable, and keep the changeable
value as an ordinary property.

## Common Pitfalls

When behavior looks wrong, check installed/runtime state before assuming the source tree is what the instance runs.

### Defined but not wired in

A standalone function or a view exists for the domain only if it is listed in the domain's `functions` or `views` map.
Writing the file is not enough: an unlisted function is invisible at runtime, callable by no one, with no error to
explain why. When a new function or view cannot be reached, first check that it is wired into the domain definition.

### Changed the schema but didn't reinstall

Editing your schema or handlers changes nothing on a running instance until you deploy and install again. The instance
keeps running the version it last installed, so a class you just added is not there yet and a handler you just fixed is
still broken. If a change does not seem to take, confirm you re-deployed and re-installed, not just saved the file.

### A public function has no kernel

In a public function or view there is no caller, so the context's `kernel` is null; reaching for it to touch the graph
throws. Use selfKernel instead, which acts as the function's own identity, whenever the entry point is public.

### Calling an instance form for a static

'method x not found... call it as /:o:class.C/x' means you used::method on a static; switch to the static slash form.

### Renaming a property orphans its data

A node's properties are stored under their fully qualified keys, so renaming a property in the schema does not rename
the data already written: the old values sit under the old key, invisible to the new name. A re-install changes the
shape, not the stored facts. When you rename or move a property, migrate the existing data in a seed or a one-off step,
or accept that old nodes will look empty.

### Renaming the origin breaks everything

A domain's origin is woven into every path its members are addressed by and into the identity its functions sign with.
Change it and every existing address, grant, and cross-domain dependency that named the old origin stops resolving. Pick
an origin you can live with up front; renaming one already in use is not an edit but a migration.

### Granting needs more than SHARE

Holding `SHARE` on a node lets you grant access, but only to rights you yourself hold: you cannot hand out EDIT if you
only have READ and SHARE. A grant that is refused, or quietly grants less than you asked, is often this: the granter is
missing the very verb they are trying to pass on. To delegate a right, make sure you hold both SHARE and that right.
