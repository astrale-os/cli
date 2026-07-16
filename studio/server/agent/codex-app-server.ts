import { spawn } from 'node:child_process'

import type { AskInput, AskResult } from './types'

const ASK_TIMEOUT_MS = 120_000

function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv | undefined {
  return extra && Object.keys(extra).length ? { ...process.env, ...extra } : undefined
}

function sandboxFor(access: AskInput['access']): 'workspace-write' | 'danger-full-access' {
  return access === 'workspace' ? 'workspace-write' : 'danger-full-access'
}

/** Use Codex's rich-client protocol only for the capability missing from
 * `codex exec`: fork a conversation without mutating its parent. */
export function runCodexForkAsk(bin: string, input: AskInput): Promise<AskResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['app-server', '--stdio'], {
      cwd: input.root,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv(input.env),
    })
    let finished = false
    let threadId = ''
    let turnId = ''
    let text = ''
    let finalText = ''
    let stderr = ''
    let nextId = 1
    let timer: ReturnType<typeof setTimeout> | undefined

    const send = (message: unknown) => child.stdin?.write(`${JSON.stringify(message)}\n`)
    const request = (method: string, params: unknown, id = nextId++) => {
      send({ method, id, params })
      return id
    }
    const finish = (result: AskResult) => {
      if (finished) return
      finished = true
      if (timer) clearTimeout(timer)
      input.signal.removeEventListener('abort', onAbort)
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
      resolve(result)
    }
    const fail = (message: string) =>
      finish({ text: finalText || text, isError: true, errorMessage: message })

    const onAbort = () => {
      if (threadId && turnId) request('turn/interrupt', { threadId, turnId }, 99)
      finish({ text: finalText || text, isError: true, errorMessage: 'canceled' })
    }
    if (input.signal.aborted) return onAbort()
    input.signal.addEventListener('abort', onAbort, { once: true })

    timer = setTimeout(() => fail('Codex side question timed out'), ASK_TIMEOUT_MS)
    const commonThread = {
      cwd: input.root,
      approvalPolicy: 'never',
      sandbox: sandboxFor(input.access),
      developerInstructions: input.appendSystemPrompt ?? null,
      ephemeral: true,
      model: input.model ?? null,
      config: { 'mcp_servers.domain-studio.enabled': false },
    }

    child.stdout?.setEncoding('utf8')
    let buffer = ''
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
          if (message.error) return fail(message.error.message ?? 'Codex app-server init failed')
          send({ method: 'initialized', params: {} })
          if (input.sessionId)
            request('thread/fork', { threadId: input.sessionId, ...commonThread }, 2)
          else request('thread/start', commonThread, 2)
          continue
        }
        if (message.id === 2) {
          if (message.error) return fail(message.error.message ?? 'Codex thread fork failed')
          threadId = message.result?.thread?.id ?? ''
          if (!threadId) return fail('Codex app-server returned no thread id')
          request(
            'turn/start',
            {
              threadId,
              input: [{ type: 'text', text: input.prompt, text_elements: [] }],
              model: input.model ?? null,
              effort: input.effort === 'max' ? 'xhigh' : (input.effort ?? null),
            },
            3,
          )
          continue
        }
        if (message.id === 3) {
          if (message.error)
            return fail(message.error.message ?? 'Codex side question failed to start')
          turnId = message.result?.turn?.id ?? turnId
          continue
        }
        if (message.method === 'turn/started') {
          turnId = message.params?.turn?.id ?? turnId
          continue
        }
        if (message.method === 'item/agentMessage/delta') {
          const delta = typeof message.params?.delta === 'string' ? message.params.delta : ''
          if (delta) {
            text += delta
            input.onDelta(delta)
          }
          continue
        }
        if (message.method === 'item/completed') {
          const item = message.params?.item
          if (item?.type === 'agentMessage' && typeof item.text === 'string') {
            finalText = item.text
            if (!text && finalText) {
              text = finalText
              input.onDelta(finalText)
            }
          }
          continue
        }
        if (message.method === 'error' && message.params?.willRetry !== true) {
          return fail(message.params?.error?.message ?? 'Codex side question failed')
        }
        if (message.method === 'turn/completed') {
          const turn = message.params?.turn
          if (turn?.status === 'failed')
            return fail(turn?.error?.message ?? 'Codex side question failed')
          finish({ text: finalText || text, isError: false })
        }
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => fail(`failed to spawn ${bin} app-server: ${error.message}`))
    child.on('close', (code) => {
      if (!finished)
        fail(
          `Codex app-server exited ${code ?? -1}${stderr ? `: ${stderr.trim().slice(-400)}` : ''}`,
        )
    })

    request(
      'initialize',
      {
        clientInfo: {
          name: 'astrale_domain_studio',
          title: 'Astrale Domain Studio',
          version: '0.1.0',
        },
        capabilities: null,
      },
      1,
    )
  })
}
