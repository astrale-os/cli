import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { findAgentBrowser } from './browser'

/**
 * Agent skills and the agent-browser tool are owned by the coding-agent harness
 * (Claude Code et al.) and by npm — not by this CLI. `astrale setup` only
 * *detects* them and delegates installation to their real installers (`npx
 * skills add`, `npm i -g agent-browser`). This module is that detection layer.
 */

/** The skill name the agent harness looks up under `<dir>/<name>/SKILL.md`. */
export const ASTRALE_CLI_SKILL = 'astrale-cli'
export const ASTRALE_DOMAIN_SKILL = 'astrale-domain'
export const AGENT_BROWSER_SKILL = 'agent-browser'

/** Published skill source consumed by `npx skills add`. */
export const ASTRALE_CLI_SKILL_SOURCE = 'astrale-os/cli'

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
