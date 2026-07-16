import { spawn } from 'node:child_process'

import type { HarnessLoadout, HarnessModelOption } from '../../../../shared/types'

import { childEnvironment, terminateProcessTree } from '../process'

const PROBE_TIMEOUT_MS = 15_000

export interface CodexModelProbe {
  ok: boolean
  nativeModel?: string
  model?: string
  modelSource?: HarnessLoadout['modelSource']
  models: HarnessModelOption[]
  detail?: string
}

/** Read the effective Codex config and the authenticated account's model catalog.
 *
 * `config/read` resolves the same project/profile/user/system layers a real turn
 * sees for this cwd. `model/list` supplies the live picker options and built-in
 * default. An explicit Studio override remains highest precedence, matching
 * Codex's documented `--model` behavior.
 */
export function probeCodexModels(
  bin: string,
  root: string,
  override?: string,
  env?: Record<string, string>,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<CodexModelProbe> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, ['app-server', '--stdio'], {
        cwd: root,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnvironment(env),
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      resolve({
        ok: false,
        models: [],
        detail: `failed to spawn ${bin} app-server: ${String(error)}`,
      })
      return
    }

    let settled = false
    let configDone = false
    let modelsDone = false
    let configModel: string | undefined
    let catalog: HarnessModelOption[] = []
    let probeError = ''
    let stderr = ''
    let buffer = ''

    const send = (message: unknown) => child.stdin?.write(`${JSON.stringify(message)}\n`)
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        terminateProcessTree(child)
      } catch {
        /* already gone */
      }
      const selected = override?.trim() || undefined
      const catalogDefault = catalog.find((model) => model.isDefault)?.id
      const nativeModel = configModel ?? catalogDefault
      const model = selected ?? nativeModel
      resolve({
        ok: configDone && modelsDone && !probeError,
        nativeModel,
        model,
        modelSource: selected
          ? 'studio'
          : configModel
            ? 'config'
            : catalogDefault
              ? 'default'
              : undefined,
        models: catalog,
        detail:
          probeError ||
          (model
            ? `Codex resolves ${model} from ${
                selected
                  ? 'this Studio domain'
                  : configModel
                    ? 'its effective config'
                    : 'its catalog default'
              }.`
            : undefined),
      })
    }
    const maybeFinish = () => {
      if (configDone && modelsDone) finish()
    }
    const timer = setTimeout(() => {
      probeError = 'Codex model probe timed out'
      configDone = true
      modelsDone = true
      finish()
    }, timeoutMs)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let message: any
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (message.id === 1) {
          if (message.error) {
            probeError = message.error.message ?? 'Codex app-server init failed'
            configDone = true
            modelsDone = true
            return finish()
          }
          send({ method: 'initialized', params: {} })
          send({ method: 'config/read', id: 2, params: { cwd: root, includeLayers: false } })
          send({ method: 'model/list', id: 3, params: { includeHidden: false, limit: 100 } })
          continue
        }
        if (message.id === 2) {
          configDone = true
          if (message.error) {
            probeError ||= message.error.message ?? 'Codex config probe failed'
          } else {
            const config = message.result?.config
            if (!config || typeof config !== 'object' || Array.isArray(config)) {
              probeError ||= 'Codex config probe returned an invalid response'
            } else {
              const raw = config.model
              configModel = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
            }
          }
          maybeFinish()
          continue
        }
        if (message.id === 3) {
          modelsDone = true
          if (message.error) {
            probeError ||= message.error.message ?? 'Codex model catalog probe failed'
          } else {
            if (!Array.isArray(message.result?.data)) {
              probeError ||= 'Codex model catalog returned an invalid response'
              maybeFinish()
              continue
            }
            catalog = message.result.data
              .map((entry: any): HarnessModelOption | null => {
                const id = String(entry?.model ?? entry?.id ?? '').trim()
                if (!id) return null
                return {
                  id,
                  label: String(entry?.displayName ?? id),
                  description:
                    typeof entry?.description === 'string' ? entry.description : undefined,
                  isDefault: entry?.isDefault === true,
                }
              })
              .filter((entry: HarnessModelOption | null): entry is HarnessModelOption => !!entry)
          }
          maybeFinish()
        }
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      probeError = `failed to spawn ${bin} app-server: ${error.message}`
      configDone = true
      modelsDone = true
      finish()
    })
    child.on('close', (code) => {
      if (settled) return
      probeError =
        probeError ||
        `Codex app-server exited ${code ?? -1}${stderr ? `: ${stderr.trim().slice(-400)}` : ''}`
      configDone = true
      modelsDone = true
      finish()
    })

    send({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: {
          name: 'astrale_domain_studio_probe',
          title: 'Astrale Domain Studio',
          version: '0.1.0',
        },
        capabilities: null,
      },
    })
  })
}
