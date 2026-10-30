---
name: astrale-domain
description: "Create, modify, test, migrate, or debug Astrale Domains: Schema, Policies, Action/Workflow runtime, integrations, Views, Datasets, and deployment. For a new Domain follow the phased workflow; for focused work load only the relevant references."
---

# Astrale Domain

Load detailed domain knowledge from the references that matches the goal.

## Kernel boundary

- Use Schema, executable evidence, and the SDK's Domain linter as guardrails.
- Domain source imports Core and DSL authoring values only through the matching semantic
  `@astrale-os/sdk/*` subpath. Do not import `@astrale-os/kernel-core` or
  `@astrale-os/kernel-dsl` directly, and do not replace them with a flat SDK root barrel.
- Keep authorization in Schema-owned Policy, callable `auth` mode, and the Kernel Roles and scopes
  the release requests; handlers execute only admitted calls and do not define a second
  authorization model.
- Choose each existential Policy Node extent deliberately: `node()` for topology-owned matching,
  `node(Class)` for a polymorphic Class family, or `node.exact(Class)` for exact identity.
- Treat the installed SDK's public exports and the current Domain source as authoritative
  for API syntax.

## Intent Router

Use this router to load only the references owned by the current task. For new Domains, also use the
phased workflow below; an existing public scaffold already satisfies its foundation phase.

- Scaffold, test, or configure TypeScript and Environments for a domain: read `references/development.md`.
- Deploy, install, publish or yank a version, roll back, rotate a deployment's secret, or decide who
  owns a development instance: read `references/release.md`.
- Author schema, vocabulary, properties, Class/Edge choices, inheritance, keys, Edge lifetimes, or
  Class Policy slots, or review a schema: read `references/schema.md` first. Always read it for
  schema work.
- Implement an Action handler, choose between an Action, a Workflow and no callable, or call
  another callable or Domain from a handler: read `references/actions.md`.
- Read the graph (a Query, its relations, pages, counts, limits): read `references/queries.md`.
- Write the graph (a Mutation, its guards, refusals and transitions): read `references/mutations.md`.
- Choose whose authority a call uses (`executor` or `caller`, `.self` or `.caller`), or reason about
  Identities and composition: read `references/authority.md`.
- Coordinate several effects, wait for a delay or a decision, or write, test, call, deploy, or migrate
  a Workflow: read `references/workflows.md`.
- Wrap an external API, define an Integration/Provider, receive webhooks, or design side-effect/retry behavior: read `references/integrations.md`.
- Decide whether to reuse/import another Astrale Domain instead of modeling its vocabulary yourself,
  or how to depend on and call one: read `references/domains.md`.
- Model sign-in users, invite/register existing people, assign Shell groups, or make someone an instance administrator: read `references/users.md`.
- Secure a Domain, Function, View, client call, public endpoint, identity, delegation, authentication
  mode, or Policy, or choose the Kernel Roles and scopes a release requests: read
  `references/policies.md`.
- Build or review browser views, mounted UI, View access, View resolution, or frontend design: read
  `references/views.md` and apply `astrale-frontend-design` for product-interface layout,
  interaction, and copy.
- Plan or qualify an installed Schema revision, data transition, or backfill; migrate a breaking
  change (a Root maintenance session by default); follow an install; repair data an install refuses;
  or uninstall a Domain with data: read `references/migration.md`.
- Optimize graph access, reduce round trips, choose indexes/queries, or review call patterns for latency: read `references/performance.md`.
- Author or update demo data — the Datasets under `tests/` the Studio draws and proves policies on:
  read `references/datasets.md`.
- Write tests, fixtures, demo flows, or smoke-test scenarios: read `references/testing.md`.
- Diagnose a failing live domain, issuer/discovery confusion, invocation routing, or runtime drift:
  read `references/debugging.md`.

## New Domain Creation Workflow

For a request to create, build, prototype, or make a POC of a Domain, follow the applicable phases in
order and load a reference only when its phase begins.

1. **Foundation:** Inspect the workspace first. When no public scaffold exists, read
   `references/development.md`; read `references/domains.md` only when deciding whether to reuse a
   native Domain. When the workspace already declares the SDK, deployment adapter, Domain definition, and
   Runtime, keep that plumbing and move directly to Schema.
2. **Schema:** Before authoring the schema, read `references/schema.md`; for sign-in users and groups,
   also read `references/users.md` before inventing identity or onboarding vocabulary.
3. **Callables:** Before implementing callables, read `references/actions.md`,
   `references/authority.md` and `references/policies.md`, then `references/queries.md` and
   `references/mutations.md` for the reads and writes they make. If an operation makes several effects or waits, also read
   `references/workflows.md`; if an external system is involved, `references/integrations.md`.
4. **Views:** When the Domain owns a browser surface, read `references/views.md` before designing or
   implementing it. Views are Schema declarations, not fields on the SDK Domain definition. Every View
   belongs to its Domain; node screens are internal routes of its frontend, not Class-bound Views.
5. **Demo data:** For a Domain with a meaningful sample graph, author a small Dataset under `tests/`,
   referenced from `astrale.config.ts`. Read `references/datasets.md` first; do not invent graph data
   for an API-only Domain or expand a focused edit into unrelated demo work.
6. **Completion:** Read `references/testing.md`; exercise the delivered public callables with
   representative success and applicable refusal inputs, then run the relevant tests, typecheck,
   lint, and build. Verify packaging when delivering a consumable package and live behavior when
   claiming deployment or integration success.

Read `references/migration.md`, `references/performance.md`, and `references/debugging.md` only when the
domain's lifecycle or current problem calls for them.

## Always-On Workflow

1. Inspect the current repo or scaffold before trusting API syntax from memory.
2. For live behavior, use `references/debugging.md` and prove the deployed/installed/runtime path before treating source edits as effective.
3. When a Schema change affects existing Datasets, keep them valid and representative in the same
   change. Read `references/datasets.md`; examples complement tests rather than exhaust every case.
4. When a problem that blocks you, costs significant time, or forces an unsatisfactory workaround
   points to Astrale rather than to this Domain, report it with `astrale issue` as the `astrale-cli`
   skill describes.
