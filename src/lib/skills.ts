import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { findAgentBrowser } from './browser'
import { runInherit } from './proc'

/**
 * Agent skills and the agent-browser tool are owned by the coding-agent harness
 * (Claude Code et al.) and by npm — not by this CLI. `astrale setup` and
 * `astrale update` only *detect* them and delegate installation to their real
 * installers (`npx skills add`, `npm i -g agent-browser`). This module is that
 * detection + delegation layer.
 */

/** The skill name the agent harness looks up under `<dir>/<name>/SKILL.md`. */
export const ASTRALE_CLI_SKILL = 'astrale-cli'
export const ASTRALE_DOMAIN_SKILL = 'astrale-domain'
export const AGENT_BROWSER_SKILL = 'agent-browser'

/**
 * Published skill source consumed by `npx skills add`. The public `astrale-os/cli`
 * repo hosts BOTH the astrale-cli and astrale-domain skills (under `skills/`), so
 * one `npx skills add astrale-os/cli` installs both; address one with
 * `astrale-os/cli@astrale-cli` or `astrale-os/cli@astrale-domain`.
 */
export const ASTRALE_CLI_SKILL_SOURCE = 'astrale-os/cli'

/** Human-facing command that installs (or refreshes) both astrale skills. */
export const SKILL_INSTALL_HINT = `npx skills add ${ASTRALE_CLI_SKILL_SOURCE}`

/**
 * Install or refresh the astrale agent skills by delegating to the skill package
 * manager (`npx skills add`). We don't reimplement skill installation — re-running
 * the real installer is also how an existing install updates to the latest
 * published SKILL.md, so this doubles as the update path. Streams `npx` output
 * live and resolves true on success. Requires Node/`npx` on PATH + network.
 */
export async function installSkills(): Promise<boolean> {
  const code = await runInherit('npx', ['skills', 'add', ASTRALE_CLI_SKILL_SOURCE, '-y'])
  return code === 0
}

/**
 * Where a skill may live, in priority order: this project's agent dirs, then the
 * user-global Claude Code dir. We probe for `SKILL.md` (not the directory) so a
 * symlinked skill — how the workspace wires astrale-cli — still resolves.
 */
function skillSearchDirs(): string[] {
  const cwd = process.cwd()
  return [
    join(cwd, '.agents', 'skills'),
    join(cwd, '.claude', 'skills'),
    join(homedir(), '.claude', 'skills'),
  ]
}

export type SkillPresence = { installed: boolean; location: string | null }

/** Is `<name>/SKILL.md` present in any known harness skills directory? */
export function detectSkill(name: string): SkillPresence {
  for (const dir of skillSearchDirs()) {
    const file = join(dir, name, 'SKILL.md')
    if (existsSync(file)) return { installed: true, location: file }
  }
  return { installed: false, location: null }
}

/** Is the `agent-browser` binary resolvable on PATH? */
export async function detectAgentBrowser(): Promise<boolean> {
  return (await findAgentBrowser()) !== null
}
