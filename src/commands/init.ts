import { mkdir } from 'node:fs/promises'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'

import { API_TOKEN_PARAM, generateApiToken } from '../lib/api-token'
import { writeConfig, configExists, type AstraleConfig } from '../lib/config'
import {
  assertDockerAvailable,
  buildManagerImage,
  composeUp,
  managerImageExists,
  managerImageTag,
  writeComposeFile,
} from '../lib/docker'
import { resolveAuth } from '../lib/keys'
import { log, spinner } from '../lib/log'
import { ASTRALE_HOME, KEYS_DIR, DATA_DIR, LOGS_DIR, COMPOSE_PATH } from '../lib/paths'

export type InitOptions = {
  managerPort?: string
  uiPort?: string
  falkorPort?: string
  graphName?: string
  yes?: boolean
}

const DEFAULTS = {
  managerPort: 4400,
  uiPort: 4300,
  falkorPort: 6379,
  graphName: 'astrale-manager',
}

export async function initCommand(opts: InitOptions = {}): Promise<void> {
  log.info('Astrale init — setting up your local installation\n')

  // ── Pre-flight checks ──────────────────────────────────────

  await checkDocker()
  await checkBun()

  // ── Detect existing install ────────────────────────────────

  if ((await configExists()) && !opts.yes) {
    const rl = createInterface({ input: stdin, output: stdout })
    const answer = await rl.question('Existing installation detected. Overwrite? [y/N] ')
    rl.close()
    if (answer.toLowerCase() !== 'y') {
      log.info('Aborted.')
      return
    }
  }

  // ── Resolve config: flags > prompts > defaults ─────────────

  const managerPort = await resolveValue(
    'Manager port',
    opts.managerPort,
    DEFAULTS.managerPort,
    opts.yes,
  )
  const uiPort = await resolveValue('UI port', opts.uiPort, DEFAULTS.uiPort, opts.yes)
  const falkorPort = await resolveValue(
    'FalkorDB port',
    opts.falkorPort,
    DEFAULTS.falkorPort,
    opts.yes,
  )
  const graphName = await resolveString('Graph name', opts.graphName, DEFAULTS.graphName, opts.yes)

  const config: AstraleConfig = {
    managerPort,
    uiPort,
    falkorPort,
    falkorHost: 'localhost',
    graphName,
    // The manager signs tokens with its own base URL as the issuer, and the
    // CLI must sign JWTs with that same value for the manager's JWKS lookup
    // to succeed. Derive it from the manager port instead of hardcoding a
    // placeholder.
    issuer: `http://localhost:${managerPort}/mngt`,
  }

  // ── Scaffold dirs ──────────────────────────────────────────

  let s = spinner('Creating directories...')
  await mkdir(ASTRALE_HOME, { recursive: true })
  await mkdir(KEYS_DIR, { recursive: true })
  await mkdir(DATA_DIR, { recursive: true })
  await mkdir(LOGS_DIR, { recursive: true })
  s.succeed('Directories created')

  // ── Generate keys ──────────────────────────────────────────

  s = spinner('Generating keypair...')
  await resolveAuth(KEYS_DIR, { issuer: config.issuer, subject: 'manager' })
  s.succeed('Keypair generated')

  // ── Write config ───────────────────────────────────────────

  await writeConfig(config)
  log.success('Config written')

  // ── Build manager image (if missing) ───────────────────────

  if (!(await managerImageExists())) {
    const tag = await managerImageTag()
    s = spinner(`Building manager image astrale-os/manager:${tag}...`)
    try {
      await buildManagerImage()
      s.succeed(`Built astrale-os/manager:${tag}`)
    } catch (e) {
      s.fail('Manager image build failed')
      throw e
    }
  } else {
    log.dim('  manager image already present — skipping build')
  }

  // ── Write compose file ─────────────────────────────────────

  const apiToken = generateApiToken()
  await writeComposeFile(COMPOSE_PATH, {
    falkorPort,
    managerPort,
    graphName,
    apiToken,
  })
  log.success('Docker compose file written')

  // ── Start the stack (falkordb + manager) ───────────────────

  s = spinner('Starting stack (falkordb + manager)...')
  await composeUp(COMPOSE_PATH)
  s.succeed('Stack is up')

  // ── Done ──────────────────────────────────────────────────

  console.log('')
  log.success('Setup complete\n')
  log.dim(`  Manager:  http://localhost:${config.managerPort}/mngt`)
  log.info(`  UI:       http://localhost:${config.managerPort}/?${API_TOKEN_PARAM}=${apiToken}`)
  log.dim('  (token is regenerated on every `astrale start`)')
  log.dim(`  Graph:    ${config.graphName}`)
  console.log('')
  log.info('Next steps:')
  log.dim('  astrale status         # check status')
  log.dim('  astrale server logs    # stream manager logs')
  log.dim('  astrale stop           # stop the stack')
}

/** Resolve a numeric option: explicit flag wins; otherwise prompt unless --yes. */
async function resolveValue(
  label: string,
  flag: string | undefined,
  defaultValue: number,
  noninteractive?: boolean,
): Promise<number> {
  if (flag !== undefined) return parseInt(flag, 10)
  if (noninteractive) return defaultValue
  const rl = createInterface({ input: stdin, output: stdout })
  const answer = await rl.question(`${label} [${defaultValue}]: `)
  rl.close()
  return parseInt(answer || String(defaultValue), 10)
}

/** Resolve a string option: explicit flag wins; otherwise prompt unless --yes. */
async function resolveString(
  label: string,
  flag: string | undefined,
  defaultValue: string,
  noninteractive?: boolean,
): Promise<string> {
  if (flag !== undefined) return flag
  if (noninteractive) return defaultValue
  const rl = createInterface({ input: stdin, output: stdout })
  const answer = await rl.question(`${label} [${defaultValue}]: `)
  rl.close()
  return answer || defaultValue
}

async function checkDocker(): Promise<void> {
  try {
    await assertDockerAvailable()
    log.success('Docker + compose detected')
  } catch {
    log.error('Docker or Docker Compose is not available. Install Docker Desktop first.')
    log.dim('  https://docs.docker.com/get-docker/')
    process.exit(1)
  }
}

async function checkBun(): Promise<void> {
  try {
    const proc = Bun.spawn(['bun', '--version'], { stdout: 'pipe', stderr: 'pipe' })
    const code = await proc.exited
    if (code !== 0) throw new Error()
    const version = await new Response(proc.stdout).text()
    log.success(`Bun ${version.trim()} detected`)
  } catch {
    log.error('Bun is not installed. Please install Bun first.')
    log.dim('  curl -fsSL https://bun.sh/install | bash')
    process.exit(1)
  }
}
