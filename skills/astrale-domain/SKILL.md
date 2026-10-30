---
name: astrale-domain
description: "Create, modify, test, migrate, or debug Astrale Domains: Schema, Policies, Action/Workflow runtime, integrations, Views, Datasets, and deployment. For a new Domain follow the phased workflow; for focused work load only the relevant references."
---

# Astrale Domain

Load only the references the task needs.

## Kernel boundary

- Domain source imports Core and DSL authoring values only through the matching
  `@astrale-os/sdk/*` subpath: never `@astrale-os/kernel-core` or `@astrale-os/kernel-dsl`, never a
  flat SDK root barrel.
- Authorization is the Kernel's: Schema Policies, the callable `auth` mode, and the Kernel Roles
  and scopes the release requests. Handlers run only admitted calls and never re-decide them.
- Writes go through the Domain's callables as `executor`; Class `create`/`update`/`delete` slots
  stay absent (`references/policies.md`).
- The installed SDK's public exports and the current Domain source are authoritative for API
  syntax, over memory. The SDK's Domain linter and executable evidence are the guardrails.

## Intent router

| Task | Read |
| --- | --- |
| Scaffold, TypeScript, Environments, local test setup | `references/development.md` |
| Deploy, install, publish or yank a version, roll back, rotate a deployment's secret, own a development instance | `references/deployment.md` |
| Schema: vocabulary, Properties, Class/Edge choices, inheritance, keys, Edge lifetimes, Methods; always for Schema work | `references/schema.md` |
| An Action handler; Action vs Workflow vs no callable; calling another callable or Domain | `references/actions.md` |
| Read the graph: a Query, relations, pages, counts, limits | `references/queries.md` |
| Write the graph: a Mutation, guards, refusals, transitions | `references/mutations.md` |
| Whose authority a call uses (`executor`/`caller`, `.self`/`.caller`), Identities, composition | `references/authority.md` |
| Several effects, a wait, a signal; write, test, call, deploy or migrate a Workflow | `references/workflows.md` |
| An external API, an Integration/Provider, webhooks, side-effect and retry design | `references/integrations.md` |
| Reuse or depend on another Domain instead of modelling its vocabulary | `references/domains.md` |
| Sign-in users, invite or register people, Shell groups, instance administrators | `references/users.md` |
| Secure a callable, View, client call or public endpoint; auth modes, Policies, Class rules, Roles and scopes | `references/policies.md` |
| Views, mounted UI, View access and resolution (and `astrale-frontend-design` for layout, interaction, copy) | `references/views.md` |
| Schema revision, data transition, backfill, breaking change (Root maintenance session), install follow-up, refused data, uninstall with data | `references/migration.md` |
| Round trips, Query shape and cost, call-pattern latency | `references/performance.md` |
| Demo data: the Datasets under `tests/` the Studio draws and proves Policies on | `references/datasets.md` |
| Tests, fixtures, demo flows, smoke scenarios | `references/testing.md` |
| A failing live Domain, issuer/discovery confusion, invocation routing, runtime drift | `references/debugging.md` |

## New Domain

Follow the applicable phases in order; load a reference when its phase begins.

1. **Foundation**: inspect the workspace. Without a public scaffold, read `references/development.md`
   (`references/domains.md` only to decide whether to reuse a native Domain). A workspace already
   declaring the SDK, deployment adapter, Domain definition and Runtime keeps that plumbing.
2. **Schema**: `references/schema.md`; for sign-in users and groups, `references/users.md` before
   inventing identity or onboarding vocabulary.
3. **Callables**: `references/actions.md`, `references/authority.md`, `references/policies.md`, then
   `references/queries.md` and `references/mutations.md`; `references/workflows.md` for several
   effects or a wait; `references/integrations.md` for an external system.
4. **Views**: when the Domain owns a browser surface, `references/views.md`. Views are Schema
   declarations owned by their Domain; a Node screen is an internal route of its frontend.
5. **Demo data**: for a meaningful sample graph, a small Dataset under `tests/`, referenced from
   `astrale.config.ts` (`references/datasets.md`). None for an API-only Domain or a focused edit.
6. **Completion**: `references/testing.md`. Exercise each delivered public callable with
   representative success and refusal inputs; run tests, typecheck, lint and build. Verify packaging
   when delivering a package, and live behavior when claiming deployment or integration success.

`references/migration.md`, `references/performance.md` and `references/debugging.md` only when the
Domain's lifecycle or the current problem calls for them.

## Always

1. Inspect the current repo or scaffold before trusting API syntax from memory.
2. Live behavior: prove the deployed, installed and running path (`references/debugging.md`) before
   treating a source edit as effective.
3. A Schema change affecting existing Datasets keeps them valid and representative in the same
   change (`references/datasets.md`).
4. A problem that blocks, costs significant time or forces an unsatisfactory workaround and points
   to Astrale rather than the Domain: report it with `astrale issue` (`astrale-cli` skill).
