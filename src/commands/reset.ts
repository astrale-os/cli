import { KernelWSClient } from '@astrale-os/kernel-client-ws'
import chalk from 'chalk'

import { readConfig } from '../lib/config'
import { formatElapsed } from '../lib/format'
import { getDefault } from '../lib/identity'
import { resolveInstanceId } from '../lib/instance'
import { signAs, resolveAuth } from '../lib/keys'
import { log, spinner } from '../lib/log'
import { KEYS_DIR } from '../lib/paths'

type ResetOptions = {
  instance?: string
  yes?: boolean
}

async function isManagerRunning(wsUrl: string): Promise<boolean> {
  const client = new KernelWSClient({
    wsUrl,
    autoConnect: false,
    reconnect: false,
    maxRetries: 0,
    requestTimeout: 3_000,
  })
  try {
    await client.connect()
    await client.close()
    return true
  } catch {
    return false
  }
}

export async function resetCommand(opts: ResetOptions): Promise<void> {
  const config = await readConfig()
  const wsUrl = `ws://localhost:${config.managerPort}/mngt/ws`

  const identity = await getDefault()
  const credential = await signAs(identity.subject, KEYS_DIR, { issuer: config.issuer })

  let managerSession: {
    close: () => Promise<void>
    serve: (opts: { port: number }) => void
  } | null = null

  // If manager is not running, start it and keep it alive after reset
  if (!(await isManagerRunning(wsUrl))) {
    log.info('Manager not running, starting...')

    const auth = await resolveAuth(KEYS_DIR, {
      issuer: config.issuer,
      subject: 'manager',
    })

    const { ManagerSession } = await import('@astrale-os/kernel-toolkit/manager')

    managerSession = await ManagerSession.boot({
      graphName: config.graphName,
      falkorPort: config.falkorPort,
      auth,
    })
    managerSession.serve({ port: config.managerPort })
  }

  const client = new KernelWSClient({
    wsUrl,
    autoConnect: false,
    reconnect: false,
    maxRetries: 0,
    requestTimeout: 30_000,
  })

  try {
    await client.connect()

    // List instances to find the target
    const instances = (await client.call(
      '/manager.astrale.ai/KernelInstance/list',
      {},
      credential,
    )) as Array<{ id: string; status: string }>

    if (instances.length === 0) {
      log.error('No kernel instances found')
      await client.close()
      if (managerSession) await managerSession.close()
      process.exit(1)
    }

    const targetId = (await resolveInstanceId(opts, config)) ?? instances[0].id

    const instance = instances.find((i) => i.id === targetId)
    if (!instance) {
      log.error(`Instance "${targetId}" not found`)
      log.dim(`  Available: ${instances.map((i) => i.id).join(', ')}`)
      await client.close()
      if (managerSession) await managerSession.close()
      process.exit(1)
    }

    // Confirm unless --yes
    if (!opts.yes) {
      const prompt = `This will clear all data in instance "${targetId}". Continue? [y/N] `
      process.stdout.write(chalk.yellow(prompt))
      const answer = await readLine()
      if (answer.toLowerCase() !== 'y') {
        log.info('Aborted')
        await client.close()
        if (managerSession) await managerSession.close()
        process.exit(0)
      }
    }

    const spin = spinner(`Resetting instance "${targetId}"...`)
    const startTime = performance.now()

    // If instance is stopped, boot it first so reboot can proceed
    if (instance.status === 'stopped' || instance.status === 'registered') {
      await client.call('/manager.astrale.ai/KernelInstance/boot', { id: targetId }, credential)
    }

    await client.call(
      '/manager.astrale.ai/KernelInstance/reboot',
      { id: targetId, clear: true },
      credential,
    )

    const elapsed = performance.now() - startTime
    spin.succeed(`Instance "${targetId}" reset ${chalk.dim(`in ${formatElapsed(elapsed)}`)}`)

    await client.close()

    if (managerSession) {
      const { startUI, stopUI } = await import('../lib/ui')
      startUI(config)

      log.info(`Manager running on ws://localhost:${config.managerPort}/mngt/ws`)
      log.info(`Playground UI on http://localhost:${config.uiPort}`)
      log.info('Press Ctrl+C to stop')
      const cleanup = async () => {
        stopUI()
        await managerSession!.close()
        process.exit(0)
      }
      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)
    } else {
      process.exit(0)
    }
  } catch (error) {
    await client.close().catch(() => {})
    if (managerSession) await managerSession.close().catch(() => {})
    log.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.resume()
    process.stdin.on('data', (chunk) => {
      data += chunk
      if (data.includes('\n')) {
        process.stdin.pause()
        resolve(data.trim())
      }
    })
  })
}
