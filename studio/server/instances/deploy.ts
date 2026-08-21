import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { DeployResult } from '../../shared/types'
import type { DomainHandle } from '../domain'

import { recordSuccessfulDeploy } from './deploy-record'

export function hasProdScript(root: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    return typeof pkg?.scripts?.prod === 'string'
  } catch {
    return false
  }
}

const SVC_URL = /https:\/\/[\w-]+\.svc\.[\w.-]+\.astrale\.ai\b/

/** Run `pnpm prod` only after an explicit outward-facing deploy request. */
export async function runDeploy(
  handle: DomainHandle,
  renderFingerprint: string | null,
): Promise<DeployResult> {
  if (!hasProdScript(handle.root)) {
    return {
      ok: false,
      url: null,
      output:
        'This domain has no "prod" script in package.json — it is not deployable via `pnpm prod`.',
    }
  }
  let out = ''
  let err = ''
  let code = 1
  try {
    const proc = Bun.spawn(['pnpm', 'prod'], {
      cwd: handle.root,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    ;[out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    code = await proc.exited
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, url: null, output: `failed to start pnpm: ${message}` }
  }
  const combined = `${out}\n${err}`.trim()
  const url = combined.match(SVC_URL)?.[0] ?? null
  const ok = code === 0
  if (ok) recordSuccessfulDeploy(handle.root, renderFingerprint, url)
  return { ok, url, output: combined.slice(-6000) }
}
