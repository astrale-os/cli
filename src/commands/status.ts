import { connect } from 'node:net'

import type { CommandDefinition } from '../command'

import { readConfig } from '../lib/config'
import { composePs } from '../lib/docker'
import { log } from '../lib/log'
import { detectManagerState } from '../lib/manager-state'
import { RAW_OUTPUT_OPTIONS, type OutputOpts, isRawOutput, output } from '../lib/output'
import { COMPOSE_PATH } from '../lib/paths'

/** TCP probe — true if something accepts a connection on host:port. */
function probeTcp(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host, port })
    const done = (ok: boolean) => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    sock.once('timeout', () => done(false))
  })
}

type ManagerMode = 'docker' | 'host' | 'unknown' | 'none'

export async function statusCommand(opts?: OutputOpts): Promise<void> {
  const isRaw = isRawOutput(opts)
  const config = await readConfig()

  const managerUrl = `http://localhost:${config.managerPort}/mngt`

  const [manager, ps, falkorUp] = await Promise.all([
    detectManagerState(config),
    composePs(COMPOSE_PATH),
    // Reachability beats provenance: the user may run FalkorDB via compose,
    // a stand-alone `docker run`, a host-installed binary, or a remote
    // forward. All that matters here is "can the manager talk to it?".
    probeTcp('127.0.0.1', config.falkorPort),
  ])

  const managerService = ps.services.find((s) => s.Service === 'manager')
  const containerRunning = managerService?.State === 'running'

  // Derive run mode:
  //   - `docker`:  the `manager` service is up in compose.
  //   - `host`:    HTTP responds AND compose query said no such service. Only
  //                trustworthy when ps.error is unset — otherwise we can't
  //                rule out a compose container that simply wasn't visible.
  //   - `unknown`: HTTP responds but compose query failed (e.g. docker not
  //                on PATH from a TCC-restricted cwd). Don't pretend.
  //   - `none`:    manager not reachable at all.
  const mode: ManagerMode = containerRunning
    ? 'docker'
    : !manager.running
      ? 'none'
      : ps.error
        ? 'unknown'
        : 'host'

  const data = {
    manager: {
      running: manager.running,
      mode,
      pid: manager.pid ?? null,
      port: config.managerPort,
      url: managerUrl,
      source: manager.source,
      containerState: managerService?.State ?? null,
      containerHealth: managerService?.Health ?? null,
    },
    falkor: {
      running: falkorUp,
      port: config.falkorPort,
    },
    graphName: config.graphName,
  }

  if (isRaw || opts?.format) {
    output(data, opts ?? {})
    return
  }

  console.log('')
  log.info('Astrale Status\n')

  if (manager.running) {
    const pidPart = manager.pid !== undefined ? ` (PID ${manager.pid})` : ''
    const modeTag =
      mode === 'docker'
        ? ' [docker]'
        : mode === 'host'
          ? ' [host]'
          : mode === 'unknown'
            ? ' [mode unknown]'
            : ''
    log.success(`Manager:   running${pidPart}${modeTag} — ${managerUrl}`)
  } else {
    log.warn('Manager:   stopped')
  }

  if (falkorUp) {
    log.success(`FalkorDB:  running (port ${config.falkorPort})`)
  } else {
    log.warn('FalkorDB:  stopped')
  }

  log.dim(`  Graph:    ${config.graphName}`)
  log.dim(`  Config:   ~/.astrale/config.json`)

  if (!manager.running) {
    console.log('')
    log.info('Run `astrale start` to start the manager')
  }
}

export default {
  name: 'status',
  description: 'Show the status of the Astrale manager',
  options: [
    {
      flags: '--format <type>',
      description: 'Output format (default: yaml in TTY, json when piped)',
      choices: ['yaml', 'json'],
    },
    ...RAW_OUTPUT_OPTIONS,
  ],
  action: async (opts) => {
    await statusCommand(opts as Parameters<typeof statusCommand>[0])
  },
} satisfies CommandDefinition
