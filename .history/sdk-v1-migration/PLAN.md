# Implementation plan

1. Record the exact CLI source, published SDK/Shell versions, and Kernel revision in an isolated
   worktree.
2. Capture the current published-package typecheck, lint, format, build, and test baseline.
3. Capture the exact V1 diagnostic and consumer census across CLI, Studio, Viewer, and `.spec`.
4. Migrate semantic owner modules in dependency order: graph and connection foundations; Admin;
   Identity; commands; Studio/Viewer canonical Schema projection.
5. Update only governing `.spec` facts proven obsolete by the new canonical owners.
6. Preserve or strengthen owner tests for every migrated behavior; add cross-boundary evidence where
   mocks previously hid a contract mismatch.
7. Run cleanup for duplicate/shadow types, retired exports, stale compatibility surfaces, and
   unnecessary guards; then a separate simplification pass for needless strictness or machinery.
8. Qualify typecheck, lint, format, tests, build, package, public exports, Shell view journey,
   representative live Kernel commands, and authority-sensitive fresh setup through ordinary
   public packages.
