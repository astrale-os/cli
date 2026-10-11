# Studio shared contract boundaries

Client and server import each definition from its one semantic owner:

- `schema.ts` owns the render IR and all schema/anatomy introspection results.
- `workspace.ts` owns persisted and workspace-facing state, including the sole
  `LayoutState` and `VisibilityState` definitions.
- `agent.ts` owns the harness-neutral agent protocol and harness configuration.
- `runtime.ts` owns Studio runtime configuration, SSE events, and CLI staleness.
- `../schema/identity.ts` owns pure canonical reference/key identity helpers.

Allowed dependency direction is identity → schema → workspace → agent → runtime.
Shared contracts never import server or client implementations.
