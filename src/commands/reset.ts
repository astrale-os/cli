import type { ManagerSession } from '@astrale-os/kernel-toolkit/manager'

import { KernelClient, type FnMap } from '@astrale-os/kernel-client'
import chalk from 'chalk'

import { resolveCredential } from '../kernel/auth'
import { readConfig } from '../lib/config'
import { formatElapsed } from '../lib/format'
import { resolveInstanceId } from '../lib/instance'
import { resolveAuth } from '../lib/keys'
import { log, spinner } from '../lib/log'
import { detectManagerState, removeManagerPid, writeManagerPid } from '../lib/manager-state'
import { KEYS_DIR } from '../lib/paths'

type ResetOptions = {
  instance?: string
  yes?: boolean
}

export async function resetCommand(opts: ResetOptions): Promise<void> {
  const config = await readConfig()
  const url = `http://localhost:${config.managerPort}/mngt`

  const credential = await resolveCredential({}, config)

  let managerSession: ManagerSession | null = null

  // If manager is not running, start it and keep it alive after reset
  if (!(await detectManagerState(config)).running) {
    log.info('Manager not running, starting...')

    const auth = await resolveAuth(KEYS_DIR, {
      issuer: config.issuer,
      subject: 'manager',
    })

    const { ManagerSession } = await import('@astrale-os/kernel-toolkit/manager')

    managerSession = await ManagerSession.boot({
      graphName: config.graphName,
      falkorPort: config.falkorPort,
      port: config.managerPort,
      auth,
    })
    managerSession.serve()
    await writeManagerPid(process.pid)
  }

  const client = new KernelClient<FnMap>({ url, requestTimeout: 30_000 })

  try {
    // List instances to find the target
    const instances = (await client.call(
      '/manager.astrale.ai/KernelInstance/list',
      {},
      credential,
    )) as Array<{ id: string; status: string }>

    if (instances.length === 0) {
      log.error('No kernel instances found')
      client.disconnect()
      if (managerSession) await managerSession.close()
      process.exit(1)
    }

    const targetId = (await resolveInstanceId(opts, config)) ?? instances[0].id

    const instance = instances.find((i) => i.id === targetId)
    if (!instance) {
      log.error(`Instance "${targetId}" not found`)
      log.dim(`  Available: ${instances.map((i) => i.id).join(', ')}`)
      client.disconnect()
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
        client.disconnect()
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

    client.disconnect()

    if (managerSession) {
      const session = managerSession
      const { startUI, stopUI } = await import('../lib/ui')
      startUI(config)

      log.info(`Manager running on http://localhost:${config.managerPort}/mngt`)
      log.info(`Playground UI on http://localhost:${config.uiPort}`)
      log.info('Press Ctrl+C to stop')
      const cleanup = async () => {
        stopUI()
        await session.close()
        await removeManagerPid()
        process.exit(0)
      }
      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)
    } else {
      process.exit(0)
    }
  } catch (error) {
    client.disconnect()
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
