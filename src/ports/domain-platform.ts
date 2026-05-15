/**
 * DomainPlatform port (SPEC §11). Concrete adapters plug into this
 * contract: cloudflare (v1), blaxel (roadmap).
 *
 * An adapter handles the concrete build/deploy pipeline for a domain
 * worker. The CLI commands (`domain init`, `domain deploy`, `domain dev
 * up/down/status`, `domain instance prepare`, `domain build`) speak
 * exclusively to this port — wrangler invocations live in the Cloudflare
 * adapter, not in command handlers.
 */

import type { DevState } from '@astrale-os/kernel-host'

export type ScaffoldOpts = {
  /** New domain slug, validated by the caller. */
  slug: string
  /** Template name (v1: 'minimal-remote'). Lives under `cli/templates/<template>/`. */
  template: string
  /** Destination directory (absolute). */
  targetDir: string
  /** Overwrite if targetDir exists. */
  force?: boolean
}

export type ScaffoldResult = {
  targetDir: string
  slug: string
  /** Human-readable commands the user should run next. */
  nextSteps: string[]
}

export type DeployOpts = {
  /** Absolute path to the domain directory (must contain `package.json`). */
  domainDir: string
  /** Preset name passed to `build:spec --domain <preset>` (default: 'prod'). */
  preset?: string
  /** Skip the post-deploy drift check (soft mode for first-time DNS-less deploys). */
  skipDriftCheck?: boolean
}

export type DeployResult = {
  url?: string
  schemaHash?: string
  sdkCommit?: string
  /** Non-fatal warnings (e.g. DNS miss, skipped drift check). */
  warnings: string[]
}

export type DevUpOpts = {
  /** Absolute path to the domain directory. */
  domainDir: string
  /** Kernel preset name (e.g. `local:manager:inprocess`). */
  kernel: string
  /** Domain preset name (e.g. `local:inprocess`). */
  domain: string
}

export type DevDownOpts = {
  domainDir: string
}

export type DevStatusOpts = {
  domainDir: string
}

export type DevDownResult = {
  /**
   * What was actually stopped during teardown. Useful for the CLI to
   * report a clean summary.
   */
  stopped: DevState['started']
}

export type InstancePrepareOpts = DevUpOpts & {
  /** Child instance id to (re)create. Defaults to `test`. */
  instanceId?: string
}

export type InstancePrepareResult = {
  instanceId: string
  domain: string
  domainUrl: string
  workerUrl: string
  controlUrl: string
  iss: string
  parent?: string
  token?: string
}

export type BuildSpecOpts = {
  domainDir: string
  /** Domain env preset name (default: 'prod'). */
  preset?: string
}

export type BuildSpecResult = {
  /** Absolute path to the produced spec.json. */
  specPath: string
}

export interface DomainPlatform {
  readonly id: string

  scaffold(opts: ScaffoldOpts): Promise<ScaffoldResult>

  deploy(opts: DeployOpts): Promise<DeployResult>

  /**
   * Bring up the local dev infrastructure for `(kernel, domain)` preset
   * pair. Idempotent: already-running services are kept. Writes a state
   * file so `devDown` can tear down only what was started.
   */
  devUp(opts: DevUpOpts): Promise<DevState>

  /**
   * Teardown what `devUp` started. No-op if no state file exists.
   * Never touches services the CLI didn't start.
   */
  devDown(opts: DevDownOpts): Promise<DevDownResult>

  /**
   * Read the persisted dev state. Returns `null` if `devUp` hasn't run
   * (or if `devDown` has cleaned up).
   */
  devStatus(opts: DevStatusOpts): Promise<DevState | null>

  /**
   * Manager-mode instance bootstrap: rebuild spec, register child
   * instance, boot, install domain, mint delegation token. Mirrors the
   * legacy `pnpm instance:prepare` exactly — shell-exportable env block.
   */
  instancePrepare(opts: InstancePrepareOpts): Promise<InstancePrepareResult>

  /**
   * Produce `spec.json` for a given domain preset (replaces
   * `pnpm build:spec --domain <preset>`).
   */
  buildSpec(opts: BuildSpecOpts): Promise<BuildSpecResult>
}
