---
name: astrale-domain
description: "Author Astrale domains end to end. Use when creating, editing, reviewing, productionizing, migrating, optimizing, securing, simulating, or debugging a domain; modeling schema; implementing handlers/functions; integrating external APIs; choosing native Astrale domains; designing views; or reasoning about permissions, delegation, kernel, seeds, core data, sample data, and live/runtime drift. Read the relevant reference for the current intent: development, modeling, implementing, integrations, domains, security, views, migration, performance, simulating, or debugging."
---

# Astrale Domain

Load detailed domain knowledge from the references that matches the goal.

## Intent Router

Pick and read the reference(s) aligned with the task.

- Draft, POC, create, deploy, install, or test a domain: read `references/development.md`.
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

## Always-On Workflow

1. Load the matching reference before giving domain-specific implementation advice.
2. For schema changes, also load `references/modeling.md`.
3. Inspect the current repo or scaffold before trusting API syntax from memory.
4. For live behavior, use `references/debugging.md` and prove the deployed/installed/runtime path before treating source edits as effective.
