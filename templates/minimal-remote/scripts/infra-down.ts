#!/usr/bin/env bun
/**
 * `infra:down` — stop every process that `infra:prepare` may have started.
 * Best-effort: missing processes are not an error.
 *
 * Mirrors distribution/scripts/infra-down.ts. See that file for rationale
 * on why we stop only our named tunnel (not every cloudflared on the host).
 */
import { spawnSync } from 'node:child_process'

import { readDomainPort } from '../envs.ts'
import { DEFAULT_TUNNEL_NAME, killWranglerTree } from './lib.ts'

const port = readDomainPort()
console.log(`==> stop wrangler dev (+ workerd tree on :${port})`)
const { killed } = killWranglerTree(port)
console.log(`    killed ${killed} listener(s) on :${port}`)

const tunnelName = process.env.MINIMAL_TUNNEL_NAME ?? DEFAULT_TUNNEL_NAME
console.log(`==> stop cloudflared tunnel (${tunnelName})`)
spawnSync('astrale', ['tunnel', 'stop', tunnelName], { stdio: 'ignore' })

console.log('==> stop astrale manager')
spawnSync('astrale', ['stop'], { stdio: 'ignore' })

console.log('Done.')
