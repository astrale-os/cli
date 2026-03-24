import { mkdir } from 'node:fs/promises'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'

import { writeConfig, configExists, type AstraleConfig } from '../lib/config'
import { writeComposeFile, startFalkor } from '../lib/docker'
import { resolveAuth } from '../lib/keys'
import { log, spinner } from '../lib/log'
import { ASTRALE_HOME, KEYS_DIR, DATA_DIR, LOGS_DIR, COMPOSE_PATH } from '../lib/paths'
import { startCommand } from './start'

export async function initCommand(): Promise<void> {
  log.info('Astrale init — setting up your local installation\n')

  // ── Pre-flight checks ──────────────────────────────────────

  await checkDocker()
  await checkBun()

  // ── Detect existing install ────────────────────────────────

  if (await configExists()) {
    const rl = createInterface({ input: stdin, output: stdout })
    const answer = await rl.question('Existing installation detected. Overwrite? [y/N] ')
    rl.close()
    if (answer.toLowerCase() !== 'y') {
      log.info('Aborted.')
      return
    }
  }

  // ── Interactive prompts ────────────────────────────────────

  const rl = createInterface({ input: stdin, output: stdout })
  const managerPort = parseInt((await rl.question('Manager port [4400]: ')) || '4400', 10)
  const uiPort = parseInt((await rl.question('UI port [4300]: ')) || '4300', 10)
  const falkorPort = parseInt((await rl.question('FalkorDB port [6379]: ')) || '6379', 10)
  const graphName = (await rl.question('Graph name [astrale-manager]: ')) || 'astrale-manager'
  rl.close()

  const config: AstraleConfig = {
    managerPort,
    uiPort,
    falkorPort,
    graphName,
    issuer: 'https://manager.astrale.ai',
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

  // ── Write compose file ─────────────────────────────────────

  await writeComposeFile(COMPOSE_PATH, { falkorPort })
  log.success('Docker compose file written')

  // ── Start FalkorDB ─────────────────────────────────────────

  s = spinner('Starting FalkorDB...')
  await startFalkor(COMPOSE_PATH)
  s.succeed('FalkorDB is running')

  // ── Start manager + UI ─────────────────────────────────────

  console.log('')
  log.success('Setup complete — starting manager + UI...\n')
  log.dim(`  UI:       http://localhost:${config.uiPort}`)
  log.dim(`  WS:       ws://localhost:${config.managerPort}/mngt/ws`)
  log.dim(`  Graph:    ${config.graphName}`)
  console.log('')

  await startCommand({ foreground: true })
}

async function checkDocker(): Promise<void> {
  try {
    const proc = Bun.spawn(['docker', 'info'], { stdout: 'pipe', stderr: 'pipe' })
    const code = await proc.exited
    if (code !== 0) throw new Error()
    log.success('Docker is running')
  } catch {
    log.error('Docker is not running. Please install and start Docker first.')
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
