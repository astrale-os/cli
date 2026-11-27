/**
 * Everything the Workspace-level modules reach outside themselves, as one injectable value: the
 * `astrale` CLI, the Domain's own commands, the versions island, the workspace's Domains and
 * their bundles, a scratch directory and the clock. Routes use the default context; tests pass
 * fakes, so no test ever starts a real command or reaches the network.
 */
import { rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StudioSchemaBundle } from '../../../shared/contracts/schema'
import type { DomainHandle } from '../../domain/registry'
import type { IslandRequest } from './island'

import { captureStudioCli } from '../../cli'
import { allDomains, getDomain } from '../../domain/registry'
import { getBundle } from '../../introspect/cache'
import { captureProcess, type CapturedProcess, type ChildOptions } from '../../process'
import { runIsland } from './island-runner'

/** Runs the `astrale` CLI the Studio was launched by. The credential never leaves it. */
export type CliRunner = (args: readonly string[], options: ChildOptions) => Promise<CapturedProcess>

/** Runs any other command to completion, such as the Domain's own `astrale-domain`. */
export type ProcessRunner = (
  command: readonly string[],
  options: ChildOptions,
) => Promise<CapturedProcess>

/** Answers one versions-island request with the SDK installed in `request.projectRoot`. */
export type IslandRunner = (request: IslandRequest, timeoutMs: number) => Promise<unknown>

export interface VersionsContext {
  cli: CliRunner
  run: ProcessRunner
  island: IslandRunner
  domains(): DomainHandle[]
  domain(id: string): DomainHandle | undefined
  /** The Domain's Studio bundle; `rebuild` reads its sources again. */
  bundle(id: string, rebuild?: boolean): Promise<StudioSchemaBundle | null>
  /** A directory this process owns, for downloaded Publication bundles, removed at its exit. */
  scratch(): Promise<string>
  /** Whether this Studio's Publish route may start a Publish: `publishSwitchOf`. */
  publishing(): boolean
  now(): number
}

/**
 * `ASTRALE_STUDIO_PUBLISH`, read strictly. Unset or `on`: the Studio's Publish route may start a
 * Publish. `off`: that route refuses every Publish (`publish-disabled`). Anything else — `OFF`,
 * `0`, `false`, an empty value — is no answer, and the Studio does not start on it rather than
 * guess which was meant.
 *
 * It covers the Studio's own Publish route, and only it. It does not cover the agent: an agent
 * turn runs commands with your own access and your own CLI sign-in (as the agent access level
 * lets it), so an agent can publish from a Studio started with `off`.
 */
export function publishSwitchOf(
  value: string | undefined,
): { readonly publishing: boolean } | { readonly problem: string } {
  if (value === undefined || value === 'on') return { publishing: true }
  if (value === 'off') return { publishing: false }
  return {
    problem: `ASTRALE_STUDIO_PUBLISH is ${JSON.stringify(value)}, and it is either on or off (unset is on): the Studio does not start on another value.`,
  }
}

let scratchDirectory: Promise<string> | undefined

export const defaultVersionsContext: VersionsContext = {
  cli: captureStudioCli,
  run: captureProcess,
  island: runIsland,
  domains: allDomains,
  domain: getDomain,
  bundle: (id, rebuild = false) => getBundle(id, rebuild),
  scratch: () =>
    (scratchDirectory ??= mkdtemp(join(tmpdir(), 'astrale-studio-publications-')).then(
      (directory) => {
        // Fetched bundles live exactly as long as the process that verified them.
        process.once('exit', () => rmSync(directory, { recursive: true, force: true }))
        return directory
      },
      (error: unknown) => {
        scratchDirectory = undefined
        throw error
      },
    )),
  // a value the start refused cannot reach here; were it changed since, it publishes nothing
  publishing: () => {
    const publish = publishSwitchOf(process.env.ASTRALE_STUDIO_PUBLISH)
    return 'publishing' in publish && publish.publishing
  },
  now: Date.now,
}
