import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildCodexArgs, CodexHarness } from './codex'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fakeCodex(root: string): string {
  const file = join(root, 'fake-codex')
  writeFileSync(
    file,
    `#!/usr/bin/env bun
const args = process.argv.slice(2)
if (args[0] === '--version') {
  console.log('codex-cli 0.test')
  process.exit(0)
}
if (args[0] === 'app-server') {
  if (process.env.FAKE_APP_MODE !== 'partial-fail') process.exit(2)
  let buffer = ''
  const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      const message = JSON.parse(line)
      if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'fake' } })
      if (message.method === 'thread/fork') send({ id: message.id, result: { thread: { id: 'fork-thread' } } })
      if (message.method === 'turn/start') {
        send({ id: message.id, result: { turn: { id: 'turn-1' } } })
        send({ method: 'item/agentMessage/delta', params: { delta: 'partial' } })
        send({ method: 'turn/completed', params: { turn: { status: 'failed', error: { message: 'late failure' } } } })
      }
    }
  })
  await new Promise(() => {})
}
if (args[0] !== 'exec') process.exit(2)

let prompt = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { prompt += chunk })
process.stdin.on('end', () => {
  if (process.env.FAKE_CODEX_LOG) {
    require('node:fs').writeFileSync(
      process.env.FAKE_CODEX_LOG,
      JSON.stringify({ args, prompt }),
    )
  }
  const thread = args[1] === 'resume' ? args[2] : 'new-thread'
  if (thread === 'rejected-thread') {
    console.error('Error: thread/resume: thread/resume failed: no rollout found for thread id rejected-thread')
    process.exit(1)
  }
  if (thread === 'transient-thread') {
    console.error('network unavailable')
    process.exit(1)
  }
  const send = (event) => process.stdout.write(JSON.stringify(event) + '\\n')
  if (prompt === 'hang') {
    const descendant = require('node:child_process').spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { stdio: 'ignore' },
    )
    if (process.env.FAKE_DESCENDANT_PID) {
      require('node:fs').writeFileSync(process.env.FAKE_DESCENDANT_PID, String(descendant.pid))
    }
    process.on('SIGTERM', () => process.exit(143))
    send({ type: 'thread.started', thread_id: thread })
    setInterval(() => {}, 1000)
    return
  }
  send({ type: 'thread.started', thread_id: thread })
  send({ type: 'turn.started' })
  send({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: 'done' } })
  send({ type: 'turn.completed', usage: { input_tokens: 7, cached_input_tokens: 2, output_tokens: 3 } })
})
`,
  )
  chmodSync(file, 0o755)
  return file
}

function turnInput(
  root: string,
  overrides: Partial<Parameters<CodexHarness['run']>[0]> = {},
): Parameters<CodexHarness['run']>[0] {
  return {
    root,
    prompt: 'work',
    signal: new AbortController().signal,
    onEvent: () => {},
    ...overrides,
  }
}

async function waitForExit(pid: number): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await Bun.sleep(25)
  }
  return false
}

describe('Codex command construction', () => {
  test('builds a new stable JSONL turn with developer instructions and approved MCP tools', () => {
    const args = buildCodexArgs({
      appendSystemPrompt: 'Studio protocol\nwith a newline',
      model: 'gpt-studio',
      effort: 'high',
      access: 'workspace',
      mcpServers: [
        {
          name: 'domain-studio',
          command: '/opt/homebrew/bin/bun',
          args: ['/studio/bridge-mcp.ts', '--config', '/domain/.domain-studio/bridge.json'],
          required: true,
          approvalMode: 'approve',
          enabledTools: ['reply_to_thread'],
        },
      ],
    })
    expect(args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-c',
      'approval_policy="never"',
      '-c',
      'sandbox_mode="workspace-write"',
      '--model',
      'gpt-studio',
      '-c',
      'model_reasoning_effort="high"',
      '-c',
      'developer_instructions="Studio protocol\\nwith a newline"',
      '-c',
      'mcp_servers.domain-studio.command="/opt/homebrew/bin/bun"',
      '-c',
      'mcp_servers.domain-studio.args=["/studio/bridge-mcp.ts","--config","/domain/.domain-studio/bridge.json"]',
      '-c',
      'mcp_servers.domain-studio.required=true',
      '-c',
      'mcp_servers.domain-studio.default_tools_approval_mode="approve"',
      '-c',
      'mcp_servers.domain-studio.enabled_tools=["reply_to_thread"]',
      '-',
    ])
  })

  test('resumes by thread id, maps Claude-only max effort, and can be ephemeral', () => {
    const args = buildCodexArgs(
      {
        sessionId: '019f-thread',
        effort: 'max',
        access: 'full',
      },
      true,
    )
    expect(args.slice(0, 3)).toEqual(['exec', 'resume', '019f-thread'])
    expect(args.join(' ')).toContain('model_reasoning_effort="xhigh"')
    expect(args.join(' ')).toContain('sandbox_mode="danger-full-access"')
    expect(args).toContain('--ephemeral')
  })
})

describe('Codex process runner', () => {
  test('streams a real JSONL subprocess turn and pipes the prompt over stdin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-codex-run-'))
    roots.push(root)
    const bin = fakeCodex(root)
    const log = join(root, 'invocation.json')
    const events: string[] = []

    const result = await new CodexHarness(bin).run(
      turnInput(root, {
        prompt: 'inspect this domain',
        env: { FAKE_CODEX_LOG: log },
        onEvent: (event) => events.push(`${event.kind}:${event.text}`),
      }),
    )

    expect(result).toMatchObject({
      sessionId: 'new-thread',
      finalText: 'done',
      tokens: 10,
      isError: false,
    })
    expect(events).toContain('status:session started')
    expect(events).toContain('message:done')
    const invocation = JSON.parse(readFileSync(log, 'utf8'))
    expect(invocation.prompt).toBe('inspect this domain')
    expect(invocation.args).toContain('--json')
  })

  test('marks an invalid stored thread but not a transient resumed-turn failure as rejected', async () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-codex-resume-'))
    roots.push(root)
    const harness = new CodexHarness(fakeCodex(root))
    const rejected = await harness.run(turnInput(root, { sessionId: 'rejected-thread' }))
    const transient = await harness.run(turnInput(root, { sessionId: 'transient-thread' }))

    expect(rejected).toMatchObject({
      isError: true,
      resumeRejected: true,
    })
    expect(rejected.errorMessage).toContain('no rollout found')
    expect(transient).toMatchObject({
      isError: true,
      resumeRejected: false,
    })
    expect(transient.errorMessage).toContain('network unavailable')
  })

  test('terminates a running process group when the turn is canceled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-codex-cancel-'))
    roots.push(root)
    const controller = new AbortController()
    const descendantPidFile = join(root, 'descendant.pid')
    let aborted = false
    const result = await new CodexHarness(fakeCodex(root)).run(
      turnInput(root, {
        prompt: 'hang',
        env: { FAKE_DESCENDANT_PID: descendantPidFile },
        signal: controller.signal,
        onEvent: (event) => {
          if (!aborted && event.kind === 'status') {
            aborted = true
            controller.abort()
          }
        },
      }),
    )

    expect(result).toMatchObject({
      isError: true,
      errorMessage: 'canceled',
    })
    const descendantPid = Number(readFileSync(descendantPidFile, 'utf8'))
    const exited = await waitForExit(descendantPid)
    if (!exited) {
      try {
        process.kill(descendantPid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
    expect(exited).toBe(true)
  })

  test('falls back to a fresh ephemeral exec without resuming the parent Ask thread', async () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-codex-ask-fallback-'))
    roots.push(root)
    const log = join(root, 'invocation.json')
    const deltas: string[] = []
    const result = await new CodexHarness(fakeCodex(root)).ask({
      root,
      prompt: 'side question',
      appendSystemPrompt: 'ask protocol',
      sessionId: 'parent-thread',
      model: 'gpt-studio',
      effort: 'high',
      access: 'workspace',
      env: { FAKE_CODEX_LOG: log },
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta),
    })

    expect(result).toEqual({ text: 'done', isError: false, errorMessage: undefined })
    expect(deltas).toEqual(['done'])
    const invocation = JSON.parse(readFileSync(log, 'utf8'))
    expect(invocation.args.slice(0, 2)).toEqual(['exec', '--json'])
    expect(invocation.args).not.toContain('resume')
    expect(invocation.args).toContain('--ephemeral')
    const modelAt = invocation.args.indexOf('--model')
    expect(invocation.args.slice(modelAt, modelAt + 2)).toEqual(['--model', 'gpt-studio'])
  })

  test('does not retry after a failed Ask attempt has already streamed partial text', async () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-codex-ask-partial-'))
    roots.push(root)
    const execLog = join(root, 'exec.json')
    const deltas: string[] = []
    const result = await new CodexHarness(fakeCodex(root)).ask({
      root,
      prompt: 'side question',
      sessionId: 'parent-thread',
      env: { FAKE_APP_MODE: 'partial-fail', FAKE_CODEX_LOG: execLog },
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta),
    })

    expect(result).toEqual({
      text: 'partial',
      isError: true,
      errorMessage: 'late failure',
    })
    expect(deltas).toEqual(['partial'])
    expect(existsSync(execLog)).toBe(false)
  })
})
