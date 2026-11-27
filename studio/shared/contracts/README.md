# Studio shared contract boundaries

Client and server import each definition from its one semantic owner:

- `schema.ts` owns the render IR and all schema/anatomy introspection results.
- `workspace.ts` owns persisted and workspace-facing state, including the sole
  `LayoutState` definition.
- `agent.ts` owns the harness-neutral agent protocol and harness configuration.
- `runtime.ts` owns Studio runtime configuration, SSE events, and CLI staleness.
- `versions.ts` owns the Workspace level: Publications, change reports, dependency
  compatibility, the registry's Domains, and Publish. It depends on `schema.ts` only.
- `scenarios.ts` owns a dataset's Scenarios, as written below `.domain-studio/` and as
  their route writes them. It depends on nothing.
- `../schema/identity.ts` owns pure canonical reference/key identity helpers.

Allowed dependency direction is identity → schema → workspace → agent → runtime.
Shared contracts never import server or client implementations.
