# CLI SDK V1 migration

This directory records the exact migration of the CLI, Studio, and Viewer from CLI `origin/main` to
the merged SDK V1 surface and active Kernel DSL redesign. It is temporal evidence, not a second CLI
specification.

Rules:

1. Existing `.spec` modules remain authoritative until current owners prove a deliberate revision.
2. Preserve command grammar, machine output, state, identity, connection, view, and Studio journeys
   unless `LEDGER.md` records a justified subtraction.
3. Replace legacy SDK shadow projections with canonical DSL/Client/SDK values; do not rebuild the
   removed Domain interpreter locally.
4. Record every genuine SDK or Kernel defect with an exact reproduction and owner.

Use `pnpm migration:inventory` to refresh the census and `pnpm migration:check` for the structural
target gate.

Until the exact cohort is published, GitHub workflows require `COHORT_REPOSITORY_TOKEN` with read
access to the private Kernel, SDK, and Shell repositories. Registry and job tokens are not accepted
as substitutes for cross-repository authority.
