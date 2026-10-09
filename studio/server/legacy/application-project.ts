/**
 * @deprecated Recognition of Projects authored before the SDK renamed the Application composition
 * to a Domain definition (astrale-os/sdk#603, @astrale-os/sdk 0.6.0-beta.11). Such a Project
 * declares `defineProject({ application })` and composes it with `defineApplication` from
 * `@astrale-os/sdk/application` (or the root facade) in `application.ts`. The replacement is the
 * canonical `defineProject({ domain })` / `defineDomain` read by `../domain`.
 *
 * Consumers: every Domain project still pinned to @astrale-os/sdk 0.6.0-beta.10 or earlier (the
 * 1Pact Domains on 0.6.0-beta.0 among them), which Studio keeps opening unchanged.
 * Deletion condition: those projects have applied the SDK guide docs/domain-definition-migration.md
 * (the 1Pact migration guide of the deployment program included); remove this module and its two
 * call sites in `../domain` in a separate breaking change.
 */

/** Project input key of the pre-#603 composition. */
export const LEGACY_PROJECT_APPLICATION_KEY = 'application'

/** Composition constructor of the pre-#603 SDK. */
export const LEGACY_DEFINE_APPLICATION = 'defineApplication'

/** Modules that exported `defineApplication` before #603. */
export const LEGACY_APPLICATION_MODULES: ReadonlySet<string> = new Set([
  '@astrale-os/sdk/application',
  '@astrale-os/sdk',
])
