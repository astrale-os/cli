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
/** An agent detected by `dir` under the home (or XDG config) directory, reading `skills` there. */
const home = (name: string, displayName: string, dir: string, skills = `${dir}/skills`) => ({
  name,
  displayName,
  global: h(skills),
  detect: same(h(dir)),
})
const config = (name: string, displayName: string, dir: string, skills = `${dir}/skills`) => ({
  name,
  displayName,
  global: c(skills),
  detect: same(c(dir)),
})

const REGISTRY: AgentTemplate[] = [
  home('aider-desk', 'AiderDesk', '.aider-desk'),
  config('amp', 'Amp', 'amp', 'agents/skills'),
  home('antigravity', 'Antigravity', '.gemini/antigravity'),
  home('antigravity-cli', 'Antigravity CLI', '.gemini/antigravity-cli'),
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
  home('augment', 'Augment', '.augment'),
  home('bob', 'IBM Bob', '.bob'),
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
  home('cline', 'Cline', '.cline', '.agents/skills'),
  home('codearts-agent', 'CodeArts Agent', '.codeartsdoer'),
  {
    name: 'codebuddy',
    displayName: 'CodeBuddy',
    global: h('.codebuddy/skills'),
    detect: (p) => [join(process.cwd(), '.codebuddy'), join(p.home, '.codebuddy')],
  },
  home('codemaker', 'Codemaker', '.codemaker'),
  home('codestudio', 'Code Studio', '.codestudio'),
  {
    name: 'codex',
    displayName: 'Codex',
    global: (p) => join(p.codex, 'skills'),
    detect: (p) => [p.codex, '/etc/codex'],
  },
  home('command-code', 'Command Code', '.commandcode'),
  {
    name: 'continue',
    displayName: 'Continue',
    global: h('.continue/skills'),
    detect: (p) => [join(process.cwd(), '.continue'), join(p.home, '.continue')],
  },
  home('cortex', 'Cortex Code', '.snowflake/cortex'),
  home('crush', 'Crush', '.config/crush'),
  home('cursor', 'Cursor', '.cursor'),
  home('deepagents', 'Deep Agents', '.deepagents', '.deepagents/agent/skills'),
  config('devin', 'Devin for Terminal', 'devin'),
  home('dexto', 'Dexto', '.dexto', '.agents/skills'),
  home('droid', 'Droid', '.factory'),
  home('firebender', 'Firebender', '.firebender'),
  home('forgecode', 'ForgeCode', '.forge'),
  home('gemini-cli', 'Gemini CLI', '.gemini'),
  home('github-copilot', 'GitHub Copilot', '.copilot'),
  config('goose', 'Goose', 'goose'),
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
  home('inference-sh', 'inference.sh', '.inferencesh'),
  {
    name: 'jazz',
    displayName: 'Jazz',
    global: h('.jazz/skills'),
    detect: (p) => [join(p.home, '.jazz'), join(process.cwd(), '.jazz')],
  },
  home('junie', 'Junie', '.junie'),
  home('iflow-cli', 'iFlow CLI', '.iflow'),
  home('kilo', 'Kilo Code', '.kilocode'),
  home('kimchi', 'Kimchi', '.config/kimchi', '.config/kimchi/harness/skills'),
  {
    name: 'kimi-code-cli',
    displayName: 'Kimi Code CLI',
    global: h('.agents/skills'),
    detect: (p) => [join(p.home, '.kimi-code'), join(p.home, '.kimi')],
  },
  home('kiro-cli', 'Kiro CLI', '.kiro'),
  home('kode', 'Kode', '.kode'),
  home('lingma', 'Lingma', '.lingma'),
  home('loaf', 'Loaf', '.loaf', '.agents/skills'),
  home('mcpjam', 'MCPJam', '.mcpjam'),
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
  home('moxby', 'Moxby', '.moxby'),
  home('mux', 'Mux', '.mux'),
  config('opencode', 'OpenCode', 'opencode'),
  home('openhands', 'OpenHands', '.openhands'),
  home('ona', 'Ona', '.ona'),
  home('pi', 'Pi', '.pi/agent'),
  {
    name: 'posit-assistant',
    displayName: 'Posit Assistant',
    global: h('.posit/assistant/skills'),
    detect: (p) => [join(p.home, '.posit/assistant'), join(p.home, '.positai')],
  },
  home('qoder', 'Qoder', '.qoder'),
  home('qoder-cn', 'Qoder CN', '.qoder-cn'),
  home('qwen-code', 'Qwen Code', '.qwen'),
  {
    name: 'replit',
    displayName: 'Replit',
    global: c('agents/skills'),
    detect: () => [join(process.cwd(), '.replit')],
  },
  home('reasonix', 'Reasonix', '.reasonix'),
  home('rovodev', 'Rovo Dev', '.rovodev'),
  home('roo', 'Roo Code', '.roo'),
  home('tabnine-cli', 'Tabnine CLI', '.tabnine', '.tabnine/agent/skills'),
  home('terramind', 'Terramind', '.terramind'),
  home('tinycloud', 'Tinycloud', '.tinycloud'),
  home('trae', 'Trae', '.trae'),
  home('trae-cn', 'Trae CN', '.trae-cn'),
  home('warp', 'Warp', '.warp', '.agents/skills'),
  home('windsurf', 'Windsurf', '.codeium/windsurf'),
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
  home('zencoder', 'Zencoder', '.zencoder'),
  home('zenflow', 'Zenflow', '.zencoder'),
  home('neovate', 'Neovate', '.neovate'),
  home('pochi', 'Pochi', '.pochi'),
  home('adal', 'AdaL', '.adal'),
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
