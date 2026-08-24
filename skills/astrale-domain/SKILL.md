---
name: astrale-domain
description: "Author Astrale domains end to end. Use when creating, editing, reviewing, productionizing, migrating, optimizing, securing, simulating, or debugging a domain; modeling schema; implementing handlers/functions; integrating external APIs; choosing native Astrale domains; designing views; or reasoning about Policy, authentication, kernel, migrations, core data, sample data, and live/runtime drift. For full creation, builds, prototypes, or POCs, follow the phased workflow across references; for focused existing-domain work, route to the relevant reference."
---

# Astrale Domain

Load detailed domain knowledge from the references that matches the goal.

## Kernel-v2 boundary

- Domain repositories and product-Domain packages do not contain `.spec/` directories. Do not add or
  regenerate them; use Schema, executable evidence, and the SDK's Domain linter as guardrails.
- Domain source imports Core and DSL authoring values only through the matching semantic
  `@astrale-os/sdk/*` subpath. Do not import `@astrale-os/kernel-core` or
  `@astrale-os/kernel-dsl` directly, and do not replace them with a flat SDK root barrel.
- Authorization is Schema-owned Policy plus callable `auth` mode. Do not restore the legacy
  `READ`/`EDIT`/`USE`/`SHARE`, permission-mask, grant/revoke, `assertPerm`, or handler-local
  `authorize` model.
- Inspect the current kernel-v2 SDK and Domain source before trusting older examples or API syntax.

## Intent Router

Use this router for focused work on an existing domain. It is not sufficient by itself for creating a
complete new domain; use the phased workflow below for that.

- Scaffold, deploy, install, or test a domain: read `references/development.md`.
- Author schema, vocabulary, properties, Class/Edge choices, or review a schema: read `references/modeling.md` first. Always read it for schema work.
- Implement handlers, callable bindings, kernel calls, graph reads/writes, or cross-domain calls: read `references/implementing.md`.
- Wrap an external API, define an Integration/Provider, receive webhooks, or design side-effect/retry behavior: read `references/integrations.md`.
- Decide whether to reuse/import a native Astrale domain instead of modeling a capability yourself: read `references/domains.md`.
- Secure a Domain, Function, View, client call, public endpoint, identity, delegation, authentication mode, or Policy: read `references/security.md`.
- Build or review browser views, mounted UI, view auth, view resolution, or frontend design: read `references/views.md`.
- Evolve an installed Schema, write a Migration, decide Migration versus Core, or handle
  reinstall/backfill behavior: read `references/migration.md`.
- Optimize graph access, reduce round trips, choose indexes/queries, or review call patterns for latency: read `references/performance.md`.
- Create fake/sample/demo data, testing, fixtures, demo flows, or smoke-test scenarios: read `references/simulating.md`.
- Diagnose a failing live domain or runtime drift: read `references/debugging.md`.

## New Domain Creation Workflow

For every request to create, build, prototype, or make a POC of a domain, follow every phase in order.
Load references when their phase begins rather than loading them all at once.

1. **Foundation:** Before scaffolding or defining boundaries, read `references/development.md` and
   `references/domains.md`.
2. **Schema:** Before authoring the schema, read `references/modeling.md`.
3. **Callables:** Before implementing callables, read `references/implementing.md` and
   `references/security.md`. If an external system is involved, also read `references/integrations.md`.
4. **Views:** When the Domain owns a browser surface, read `references/views.md` before designing or
   implementing it. Views are Schema declarations, not fields on the SDK Domain definition.
5. **Completion:** Read `references/simulating.md` and apply its validation workflow before considering
   the domain complete.

Read `references/migration.md`, `references/performance.md`, and `references/debugging.md` only when the
domain's lifecycle or current problem calls for them.

## Always-On Workflow

1. Classify the request as full domain creation or focused work on an existing domain.
2. For full creation, follow the phased workflow; for focused work, load the router's matching references.
3. For schema changes, always load `references/modeling.md`.
4. Inspect the current repo or scaffold before trusting API syntax from memory.
5. For live behavior, use `references/debugging.md` and prove the deployed/installed/runtime path before treating source edits as effective.
