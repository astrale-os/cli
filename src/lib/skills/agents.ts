import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Global agent registry compatible with `skills@1.5.23`.
 *
 * The registry shape and paths are derived from vercel-labs/skills (MIT). We
 * keep the data local so the standalone Astrale binary never needs Node/npx.
 */
export type SkillAgent = {
  name: string
  displayName: string
  globalSkillsDir: string
  detected: boolean
}

type AgentTemplate = {
  name: string
  displayName: string
  global: (paths: AgentPaths) => string
  detect: (paths: AgentPaths) => string[]
}

type AgentPaths = {
  home: string
  config: string
  codex: string
  claude: string
  vibe: string
  hermes: string
  autohand: string
  grok: string
}

const h = (path: string) => (paths: AgentPaths) => join(paths.home, path)
const c = (path: string) => (paths: AgentPaths) => join(paths.config, path)
const same = (path: (paths: AgentPaths) => string) => (paths: AgentPaths) => [path(paths)]

const REGISTRY: AgentTemplate[] = [
  {
    name: 'aider-desk',
    displayName: 'AiderDesk',
    global: h('.aider-desk/skills'),
    detect: same(h('.aider-desk')),
  },
  { name: 'amp', displayName: 'Amp', global: c('agents/skills'), detect: same(c('amp')) },
  {
    name: 'antigravity',
    displayName: 'Antigravity',
    global: h('.gemini/antigravity/skills'),
    detect: same(h('.gemini/antigravity')),
  },
  {
    name: 'antigravity-cli',
    displayName: 'Antigravity CLI',
    global: h('.gemini/antigravity-cli/skills'),
    detect: same(h('.gemini/antigravity-cli')),
  },
  {
    name: 'astrbot',
    displayName: 'AstrBot',
    global: h('.astrbot/data/skills'),
    detect: (p) => [join(process.cwd(), 'data/skills'), join(p.home, '.astrbot')],
  },
  {
    name: 'autohand-code',
    displayName: 'Autohand Code CLI',
    global: (p) => join(p.autohand, 'skills'),
    detect: (p) => [p.autohand],
  },
  {
    name: 'augment',
    displayName: 'Augment',
    global: h('.augment/skills'),
    detect: same(h('.augment')),
  },
  { name: 'bob', displayName: 'IBM Bob', global: h('.bob/skills'), detect: same(h('.bob')) },
  {
    name: 'claude-code',
    displayName: 'Claude Code',
    global: (p) => join(p.claude, 'skills'),
    detect: (p) => [p.claude],
  },
  {
    name: 'openclaw',
    displayName: 'OpenClaw',
    global: (p) => openClawSkills(p.home),
    detect: (p) => [join(p.home, '.openclaw'), join(p.home, '.clawdbot'), join(p.home, '.moltbot')],
  },
  { name: 'cline', displayName: 'Cline', global: h('.agents/skills'), detect: same(h('.cline')) },
  {
    name: 'codearts-agent',
    displayName: 'CodeArts Agent',
    global: h('.codeartsdoer/skills'),
    detect: same(h('.codeartsdoer')),
  },
  {
    name: 'codebuddy',
    displayName: 'CodeBuddy',
    global: h('.codebuddy/skills'),
    detect: (p) => [join(process.cwd(), '.codebuddy'), join(p.home, '.codebuddy')],
  },
  {
    name: 'codemaker',
    displayName: 'Codemaker',
    global: h('.codemaker/skills'),
    detect: same(h('.codemaker')),
  },
  {
    name: 'codestudio',
    displayName: 'Code Studio',
    global: h('.codestudio/skills'),
    detect: same(h('.codestudio')),
  },
  {
    name: 'codex',
    displayName: 'Codex',
    global: (p) => join(p.codex, 'skills'),
    detect: (p) => [p.codex, '/etc/codex'],
  },
  {
    name: 'command-code',
    displayName: 'Command Code',
    global: h('.commandcode/skills'),
    detect: same(h('.commandcode')),
  },
  {
    name: 'continue',
    displayName: 'Continue',
    global: h('.continue/skills'),
    detect: (p) => [join(process.cwd(), '.continue'), join(p.home, '.continue')],
  },
  {
    name: 'cortex',
    displayName: 'Cortex Code',
    global: h('.snowflake/cortex/skills'),
    detect: same(h('.snowflake/cortex')),
  },
  {
    name: 'crush',
    displayName: 'Crush',
    global: h('.config/crush/skills'),
    detect: same(h('.config/crush')),
  },
  {
    name: 'cursor',
    displayName: 'Cursor',
    global: h('.cursor/skills'),
    detect: same(h('.cursor')),
  },
  {
    name: 'deepagents',
    displayName: 'Deep Agents',
    global: h('.deepagents/agent/skills'),
    detect: same(h('.deepagents')),
  },
  {
    name: 'devin',
    displayName: 'Devin for Terminal',
    global: c('devin/skills'),
    detect: same(c('devin')),
  },
  { name: 'dexto', displayName: 'Dexto', global: h('.agents/skills'), detect: same(h('.dexto')) },
  {
    name: 'droid',
    displayName: 'Droid',
    global: h('.factory/skills'),
    detect: same(h('.factory')),
  },
  {
    name: 'firebender',
    displayName: 'Firebender',
    global: h('.firebender/skills'),
    detect: same(h('.firebender')),
  },
  {
    name: 'forgecode',
    displayName: 'ForgeCode',
    global: h('.forge/skills'),
    detect: same(h('.forge')),
  },
  {
    name: 'gemini-cli',
    displayName: 'Gemini CLI',
    global: h('.gemini/skills'),
    detect: same(h('.gemini')),
  },
  {
    name: 'github-copilot',
    displayName: 'GitHub Copilot',
    global: h('.copilot/skills'),
    detect: same(h('.copilot')),
  },
  { name: 'goose', displayName: 'Goose', global: c('goose/skills'), detect: same(c('goose')) },
  {
    name: 'grok',
    displayName: 'Grok Build',
    global: (p) => join(p.grok, 'skills'),
    detect: (p) => [p.grok],
  },
  {
    name: 'hermes-agent',
    displayName: 'Hermes Agent',
    global: (p) => join(p.hermes, 'skills'),
    detect: (p) => [p.hermes],
  },
  {
    name: 'inference-sh',
    displayName: 'inference.sh',
    global: h('.inferencesh/skills'),
    detect: same(h('.inferencesh')),
  },
  {
    name: 'jazz',
    displayName: 'Jazz',
    global: h('.jazz/skills'),
    detect: (p) => [join(p.home, '.jazz'), join(process.cwd(), '.jazz')],
  },
  { name: 'junie', displayName: 'Junie', global: h('.junie/skills'), detect: same(h('.junie')) },
  {
    name: 'iflow-cli',
    displayName: 'iFlow CLI',
    global: h('.iflow/skills'),
    detect: same(h('.iflow')),
  },
  {
    name: 'kilo',
    displayName: 'Kilo Code',
    global: h('.kilocode/skills'),
    detect: same(h('.kilocode')),
  },
  {
    name: 'kimchi',
    displayName: 'Kimchi',
    global: h('.config/kimchi/harness/skills'),
    detect: same(h('.config/kimchi')),
  },
  {
    name: 'kimi-code-cli',
    displayName: 'Kimi Code CLI',
    global: h('.agents/skills'),
    detect: (p) => [join(p.home, '.kimi-code'), join(p.home, '.kimi')],
  },
  {
    name: 'kiro-cli',
    displayName: 'Kiro CLI',
    global: h('.kiro/skills'),
    detect: same(h('.kiro')),
  },
  { name: 'kode', displayName: 'Kode', global: h('.kode/skills'), detect: same(h('.kode')) },
  {
    name: 'lingma',
    displayName: 'Lingma',
    global: h('.lingma/skills'),
    detect: same(h('.lingma')),
  },
  { name: 'loaf', displayName: 'Loaf', global: h('.agents/skills'), detect: same(h('.loaf')) },
  {
    name: 'mcpjam',
    displayName: 'MCPJam',
    global: h('.mcpjam/skills'),
    detect: same(h('.mcpjam')),
  },
  {
    name: 'minimax-code',
    displayName: 'MiniMax Code',
    global: h('.minimax/skills'),
    detect: (p) => [join(p.home, '.minimax'), '/Applications/MiniMax Code.app'],
  },
  {
    name: 'mistral-vibe',
    displayName: 'Mistral Vibe',
    global: (p) => join(p.vibe, 'skills'),
    detect: (p) => [p.vibe],
  },
  { name: 'moxby', displayName: 'Moxby', global: h('.moxby/skills'), detect: same(h('.moxby')) },
  { name: 'mux', displayName: 'Mux', global: h('.mux/skills'), detect: same(h('.mux')) },
  {
    name: 'opencode',
    displayName: 'OpenCode',
    global: c('opencode/skills'),
    detect: same(c('opencode')),
  },
  {
    name: 'openhands',
    displayName: 'OpenHands',
    global: h('.openhands/skills'),
    detect: same(h('.openhands')),
  },
  { name: 'ona', displayName: 'Ona', global: h('.ona/skills'), detect: same(h('.ona')) },
  { name: 'pi', displayName: 'Pi', global: h('.pi/agent/skills'), detect: same(h('.pi/agent')) },
  {
    name: 'posit-assistant',
    displayName: 'Posit Assistant',
    global: h('.posit/assistant/skills'),
    detect: (p) => [join(p.home, '.posit/assistant'), join(p.home, '.positai')],
  },
  { name: 'qoder', displayName: 'Qoder', global: h('.qoder/skills'), detect: same(h('.qoder')) },
  {
    name: 'qoder-cn',
    displayName: 'Qoder CN',
    global: h('.qoder-cn/skills'),
    detect: same(h('.qoder-cn')),
  },
  {
    name: 'qwen-code',
    displayName: 'Qwen Code',
    global: h('.qwen/skills'),
    detect: same(h('.qwen')),
  },
  {
    name: 'replit',
    displayName: 'Replit',
    global: c('agents/skills'),
    detect: () => [join(process.cwd(), '.replit')],
  },
  {
    name: 'reasonix',
    displayName: 'Reasonix',
    global: h('.reasonix/skills'),
    detect: same(h('.reasonix')),
  },
  {
    name: 'rovodev',
    displayName: 'Rovo Dev',
    global: h('.rovodev/skills'),
    detect: same(h('.rovodev')),
  },
  { name: 'roo', displayName: 'Roo Code', global: h('.roo/skills'), detect: same(h('.roo')) },
  {
    name: 'tabnine-cli',
    displayName: 'Tabnine CLI',
    global: h('.tabnine/agent/skills'),
    detect: same(h('.tabnine')),
  },
  {
    name: 'terramind',
    displayName: 'Terramind',
    global: h('.terramind/skills'),
    detect: same(h('.terramind')),
  },
  {
    name: 'tinycloud',
    displayName: 'Tinycloud',
    global: h('.tinycloud/skills'),
    detect: same(h('.tinycloud')),
  },
  { name: 'trae', displayName: 'Trae', global: h('.trae/skills'), detect: same(h('.trae')) },
  {
    name: 'trae-cn',
    displayName: 'Trae CN',
    global: h('.trae-cn/skills'),
    detect: same(h('.trae-cn')),
  },
  { name: 'warp', displayName: 'Warp', global: h('.agents/skills'), detect: same(h('.warp')) },
  {
    name: 'windsurf',
    displayName: 'Windsurf',
    global: h('.codeium/windsurf/skills'),
    detect: same(h('.codeium/windsurf')),
  },
  {
    name: 'zed',
    displayName: 'Zed',
    global: h('.agents/skills'),
    detect: (p) => [
      join(p.config, 'zed'),
      ...(process.env.APPDATA ? [join(process.env.APPDATA, 'Zed')] : []),
    ],
  },
  {
    name: 'zcode',
    displayName: 'ZCode',
    global: h('.zcode/skills'),
    detect: (p) => [join(p.home, '.zcode'), '/Applications/ZCode.app'],
  },
  {
    name: 'zencoder',
    displayName: 'Zencoder',
    global: h('.zencoder/skills'),
    detect: same(h('.zencoder')),
  },
  {
    name: 'zenflow',
    displayName: 'Zenflow',
    global: h('.zencoder/skills'),
    detect: same(h('.zencoder')),
  },
  {
    name: 'neovate',
    displayName: 'Neovate',
    global: h('.neovate/skills'),
    detect: same(h('.neovate')),
  },
  { name: 'pochi', displayName: 'Pochi', global: h('.pochi/skills'), detect: same(h('.pochi')) },
  { name: 'adal', displayName: 'AdaL', global: h('.adal/skills'), detect: same(h('.adal')) },
  { name: 'universal', displayName: 'Universal', global: c('agents/skills'), detect: () => [] },
]

function openClawSkills(home: string): string {
  for (const name of ['.openclaw', '.clawdbot', '.moltbot']) {
    if (existsSync(join(home, name))) return join(home, name, 'skills')
  }
  return join(home, '.openclaw', 'skills')
}

function paths(home = homedir()): AgentPaths {
  const environment = resolve(home) === resolve(homedir()) ? process.env : {}
  const config = environment.XDG_CONFIG_HOME?.trim() || join(home, '.config')
  return {
    home,
    config,
    codex: environment.CODEX_HOME?.trim() || join(home, '.codex'),
    claude: environment.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude'),
    vibe: environment.VIBE_HOME?.trim() || join(home, '.vibe'),
    hermes: environment.HERMES_HOME?.trim() || join(home, '.hermes'),
    autohand: environment.AUTOHAND_HOME?.trim() || join(home, '.autohand'),
    grok: environment.GROK_HOME?.trim() || join(home, '.grok'),
  }
}

export function skillAgents(home = homedir()): SkillAgent[] {
  const resolved = paths(home)
  return REGISTRY.map((agent) => ({
    name: agent.name,
    displayName: agent.displayName,
    globalSkillsDir: resolve(agent.global(resolved)),
    detected: agent.detect(resolved).some(existsSync),
  }))
}
