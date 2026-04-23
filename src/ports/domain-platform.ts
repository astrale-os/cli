/**
 * DomainPlatform port (SPEC §11). Concrete adapters plug into this
 * contract: cloudflare (v1), blaxel (roadmap).
 *
 * An adapter handles the concrete build/deploy pipeline for a domain
 * worker. The CLI commands (`domain init`, `domain deploy`) speak
 * exclusively to this port — wrangler invocations live in the Cloudflare
 * adapter, not in command handlers.
 */

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
  url: string
  schemaHash: string
  sdkCommit: string
  /** Non-fatal warnings (e.g. DNS miss, skipped drift check). */
  warnings: string[]
}

export interface DomainPlatform {
  readonly id: string

  scaffold(opts: ScaffoldOpts): Promise<ScaffoldResult>

  deploy(opts: DeployOpts): Promise<DeployResult>
}
