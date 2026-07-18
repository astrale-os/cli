---
name: astrale-domain
description: "Author Astrale domains end to end. Use when creating, editing, reviewing, productionizing, migrating, optimizing, securing, simulating, or debugging a domain; modeling schema; implementing handlers/functions; integrating external APIs; choosing native Astrale domains; designing views; or reasoning about permissions, delegation, kernel, seeds, core data, sample data, and live/runtime drift. For full creation, builds, prototypes, or POCs, follow the phased workflow across references; for focused existing-domain work, route to the relevant reference."
---

# Astrale Domain

Load detailed domain knowledge from the references that matches the goal.

## Intent Router

Use this router for focused work on an existing domain. It is not sufficient by itself for creating a
complete new domain; use the phased workflow below for that.

- Scaffold, deploy, install, or test a domain: read `references/development.md`.
- Author schema, vocabulary, properties, class/interface/edge choices, or review a schema: read `references/modeling.md` first. Always read it for schema work.
- Implement handlers, remote functions, kernel calls, graph reads/writes, or cross-domain calls: read `references/implementing.md`.
- Wrap an external API, build deps/ports, receive webhooks, or design side-effect/retry behavior: read `references/integrations.md`.
- Decide whether to reuse/import a native Astrale domain instead of modeling a capability yourself: read `references/domains.md`.
- Secure a domain, function, view, client call, public endpoint, grant, delegation, permission, authentication, or authorization hook: read `references/security.md`.
- Build or review browser views, mounted UI, view auth, view resolution, or frontend design: read `references/views.md`.
- Evolve an installed schema, write a migration, decide seed vs core, or handle reinstall/backfill behavior: read `references/migration.md`.
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
4. **Views:** Before designing or implementing the interface, read `references/views.md`. Every domain
   must include views; they are part of the domain definition, not an optional follow-up.
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
