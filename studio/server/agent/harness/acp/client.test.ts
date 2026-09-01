import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AcpClaudeHarness } from './claude'
import { AcpCodexHarness } from './codex'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fakeAcpAgent(root: string): string[] {
  const file = join(root, 'fake-acp-agent.ts')
  writeFileSync(
    file,
    `import { appendFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const log = process.env.FAKE_ACP_LOG
const provider = process.env.FAKE_ACP_PROVIDER || 'codex'
const mode = process.env.FAKE_ACP_MODE || 'normal'
const effortId = provider === 'codex' ? 'reasoning_effort' : 'effort'
let buffer = ''
let promptRequest
let currentModel = 'native'

const record = (value) => {
  if (log) appendFileSync(log, JSON.stringify(value) + '\\n')
}
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\\n')
const modes = () => ({
  currentModeId: provider === 'codex' ? 'read-only' : 'default',
  availableModes: provider === 'codex'
    ? [
        { id: 'read-only', name: 'Read only' },
        { id: 'agent', name: 'Agent' },
        { id: 'agent-full-access', name: 'Full' },
      ]
    : [
        { id: 'default', name: 'Default' },
        { id: 'acceptEdits', name: 'Accept edits' },
        { id: 'bypassPermissions', name: 'Bypass' },
      ],
})
const configOptions = () => [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: currentModel,
    options: [
      { value: 'native', name: 'Native' },
      { value: 'studio-model', name: 'Studio' },
    ],
  },
  ...(process.env.FAKE_ACP_NO_EFFORT === '1'
    ? []
    : [
        {
          id: effortId,
          name: 'Effort',
          category: 'thought_level',
          type: 'select',
          currentValue: 'medium',
          options: ['low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({
            value,
            name: value,
          })),
        },
      ]),
]
const update = (sessionId, value) =>
  send({ method: 'session/update', params: { sessionId, update: value } })

record({
  type: 'boot',
  env: {
    CODEX_PATH: process.env.CODEX_PATH,
    CODEX_CONFIG: process.env.CODEX_CONFIG,
    INITIAL_AGENT_MODE: process.env.INITIAL_AGENT_MODE,
    CLAUDE_CODE_EXECUTABLE: process.env.CLAUDE_CODE_EXECUTABLE,
    DOMAIN_STUDIO_CLAUDE_ARGS: process.env.DOMAIN_STUDIO_CLAUDE_ARGS,
  },
})

function finishPrompt(stopReason = 'end_turn') {
  update(promptRequest.params.sessionId, {
    sessionUpdate: 'agent_message_chunk',
    messageId: 'answer',
    content: { type: 'text', text: ' world' },
  })
  send({
    id: promptRequest.id,
    result: {
      stopReason,
      usage: { totalTokens: 12, inputTokens: 7, outputTokens: 5 },
    },
  })
  promptRequest = undefined
}

function handle(message) {
  record({ type: 'message', message })
  if (message.id === 'permission-1' && (message.result || message.error)) {
    if (mode !== 'hang') finishPrompt()
    return
  }
  if (!message.method) return
  const params = message.params || {}
  switch (message.method) {
    case 'initialize':
      send({
        id: message.id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: 'fake-acp', version: '0.test' },
          agentCapabilities: {
            sessionCapabilities: {
              resume: {},
              delete: {},
              ...(process.env.FAKE_ACP_FORK === '0' ? {} : { fork: {} }),
            },
          },
        },
      })
      return
    case 'session/new':
      send({ id: message.id, result: { sessionId: 'new-session', modes: modes(), configOptions: configOptions() } })
      return
    case 'session/resume':
      if (params.sessionId === 'missing-session') {
        send({ id: message.id, error: { code: -32000, message: 'session not found' } })
        return
      }
      send({ id: message.id, result: { modes: modes(), configOptions: configOptions() } })
      return
    case 'session/fork':
      if (process.env.FAKE_ACP_FORK_FAIL === '1') {
        send({ id: message.id, error: { code: -32000, message: 'fork failed' } })
        return
      }
      send({
        id: message.id,
        result: {
          sessionId: 'fork-session',
          ...(process.env.FAKE_ACP_EMPTY_FORK === '1'
            ? {}
            : { modes: modes(), configOptions: configOptions() }),
        },
      })
      return
    case 'session/set_mode':
      send({ id: message.id, result: {} })
      return
    case 'session/set_config_option':
      if (params.configId === 'model') currentModel = params.value
      send({ id: message.id, result: { configOptions: configOptions() } })
      return
    case 'session/delete':
      send({ id: message.id, result: {} })
      return
    case 'session/prompt':
      promptRequest = message
      update(params.sessionId, {
        sessionUpdate: 'agent_thought_chunk',
        messageId: 'thought',
        content: { type: 'text', text: 'checking' },
      })
      update(params.sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Read package.json',
        name: 'Read',
        kind: 'read',
        status: 'in_progress',
        locations: [{ path: params.prompt[0].text === 'hang' ? '/tmp/hang' : '/repo/package.json' }],
      })
      update(params.sessionId, {
        sessionUpdate: 'plan',
        entries: [{ content: 'Verify ACP', priority: 'high', status: 'in_progress' }],
      })
      update(params.sessionId, {
        sessionUpdate: 'usage_update',
        used: 12,
        size: 200000,
        cost: { amount: 0.01, currency: 'USD' },
      })
      update(params.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'answer',
        content: { type: 'text', text: 'Hello' },
      })
      if (mode === 'partial-fail') {
        send({ id: message.id, error: { code: -32000, message: 'late failure' } })
        return
      }
      if (mode === 'hang') {
        const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' })
        if (process.env.FAKE_DESCENDANT_PID) writeFileSync(process.env.FAKE_DESCENDANT_PID, String(descendant.pid))
        process.on('SIGTERM', () => {})
      }
      send({
        id: 'permission-1',
        method: 'session/request_permission',
        params: {
          sessionId: params.sessionId,
          toolCall: { toolCallId: 'tool-1', title: 'Read package.json' },
          options: [
            { optionId: 'reject', name: 'No', kind: 'reject_once' },
            { optionId: 'allow', name: 'Yes', kind: 'allow_once' },
          ],
        },
      })
      return
    case 'session/cancel':
      return
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newline
  while ((newline = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) handle(JSON.parse(line))
  }
})
process.stdin.on('end', () => {
  if (mode !== 'hang') process.exit(0)
})
process.stdin.resume()
`,
  )
  return [process.execPath, file]
}

interface LogEntry {
  type: 'boot' | 'message'
  env?: Record<string, string | undefined>
  message?: {
    id?: string | number
    method?: string
    params?: Record<string, any>
    result?: Record<string, any>
  }
}

function readLog(file: string): LogEntry[] {
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function messages(file: string) {
  return readLog(file).flatMap((entry) => (entry.message ? [entry.message] : []))
}

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition did not become true before timeout')
    await Bun.sleep(20)
  }
}

async function waitForExit(pid: number): Promise<boolean> {
  for (let index = 0; index < 80; index++) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await Bun.sleep(25)
  }
  return false
}

describe('ACP harness adapter', () => {
  test('probes agent and model diagnostics through a disposable ACP session without prompting', async () => {
    const root = temporaryRoot('studio-acp-probe-')
    const log = join(root, 'acp.jsonl')
    const harness = new AcpCodexHarness('/opt/codex-test', fakeAcpAgent(root))

    expect(await harness.health()).toMatchObject({
      ok: true,
      bin: '/opt/codex-test',
      version: '0.test',
    })
    const loadout = await harness.loadout(root, {
      model: 'studio-model',
      env: { FAKE_ACP_LOG: log, FAKE_ACP_PROVIDER: 'codex' },
      refresh: true,
    })

    expect(loadout).toMatchObject({
      ok: true,
      nativeModel: 'native',
      model: 'studio-model',
      modelSource: 'studio',
      cwd: root,
      protocolVersion: 1,
      agentName: 'fake-acp',
      agentVersion: '0.test',
      source: 'acp',
      models: [
        { id: 'native', label: 'Native' },
        { id: 'studio-model', label: 'Studio' },
      ],
      // the reasoning ladder comes back with the model, so the composer can offer
      // exactly the rungs this agent named — and say which one it is on
      effort: 'medium',
      nativeEffort: 'medium',
      efforts: [
        { id: 'low', label: 'low' },
        { id: 'medium', label: 'medium' },
        { id: 'high', label: 'high' },
        { id: 'xhigh', label: 'xhigh' },
        { id: 'max', label: 'max' },
      ],
    })
    expect(messages(log).flatMap((message) => (message.method ? [message.method] : []))).toEqual([
      'initialize',
      'session/new',
      'session/set_config_option',
      'session/delete',
    ])
  })

  test('Claude adds Studio’s own top rung above the ladder ACP reports', async () => {
    const root = temporaryRoot('studio-acp-probe-claude-')
    const harness = new AcpClaudeHarness('/opt/claude-test', fakeAcpAgent(root))

    const loadout = await harness.loadout(root, {
      env: { FAKE_ACP_PROVIDER: 'claude' },
      refresh: true,
    })
    expect(loadout.efforts?.map((option) => option.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultracode',
    ])
  })

  test('a model with no ladder reports none, rather than an empty guess', async () => {
    const root = temporaryRoot('studio-acp-probe-flat-')
    const harness = new AcpCodexHarness('/opt/codex-test', fakeAcpAgent(root))

    const loadout = await harness.loadout(root, {
      env: { FAKE_ACP_PROVIDER: 'codex', FAKE_ACP_NO_EFFORT: '1' },
      refresh: true,
    })
    expect(loadout.ok).toBe(true)
    expect(loadout.efforts).toBeUndefined()
    expect(loadout.effort).toBeUndefined()
  })

  test('runs Codex through ACP and maps MCP, configuration, permissions, usage, and events', async () => {
    const root = temporaryRoot('studio-acp-codex-')
    const log = join(root, 'acp.jsonl')
    const events: string[] = []
    const harness = new AcpCodexHarness('/opt/codex-test', fakeAcpAgent(root))

    const result = await harness.run({
      root,
      prompt: 'inspect this domain',
      appendSystemPrompt: 'Return the Studio machine block.',
      model: 'studio-model',
      effort: 'max',
      access: 'workspace',
      mcpServers: [
        {
          name: 'domain-studio',
          command: process.execPath,
          args: ['bridge.ts'],
          env: { BRIDGE_TEST: 'yes' },
          required: true,
          approvalMode: 'approve',
          enabledTools: ['reply_to_thread'],
        },
      ],
      env: { FAKE_ACP_LOG: log, FAKE_ACP_PROVIDER: 'codex' },
      signal: new AbortController().signal,
      onEvent: (event) => events.push(`${event.kind}:${event.text}`),
    })

    expect(result).toMatchObject({
      sessionId: 'new-session',
      finalText: 'Hello world',
      tokens: 12,
      costUsd: 0.01,
      numTurns: 1,
      isError: false,
    })
    expect(events).toContain('status:session started via ACP')
    expect(events).toContain('thinking:checking')
    expect(events).toContain('tool:Read package.json')
    expect(events).toContain('status:→ Verify ACP')
    expect(events).toContain('message:Hello world')

    const entries = readLog(log)
    expect(entries[0].env).toMatchObject({
      CODEX_PATH: '/opt/codex-test',
      INITIAL_AGENT_MODE: 'agent',
    })
    expect(JSON.parse(entries[0].env!.CODEX_CONFIG!)).toMatchObject({
      developer_instructions: 'Return the Studio machine block.',
    })
    const requests = messages(log)
    const methods = requests.flatMap((message) => (message.method ? [message.method] : []))
    expect(methods).toEqual([
      'initialize',
      'session/new',
      'session/set_mode',
      'session/set_config_option',
      'session/set_config_option',
      'session/prompt',
    ])
    const created = requests.find((message) => message.method === 'session/new')!
    expect(created.params!.mcpServers[0]).toMatchObject({
      name: 'domain-studio',
      command: process.execPath,
      args: ['bridge.ts'],
      env: [{ name: 'BRIDGE_TEST', value: 'yes' }],
      _meta: {
        astrale: {
          required: true,
          approvalMode: 'approve',
          enabledTools: ['reply_to_thread'],
        },
      },
    })
    const configRequests = requests.filter(
      (message) => message.method === 'session/set_config_option',
    )
    expect(configRequests.map((message) => message.params!.configId)).toEqual([
      'model',
      'reasoning_effort',
    ])
    // `max` is a rung Codex really has, so it is sent as asked rather than capped
    expect(configRequests.map((message) => message.params!.value)).toEqual(['studio-model', 'max'])
    expect(requests.find((message) => message.id === 'permission-1')!.result).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow' },
    })
  })

  test('resumes Claude Code through ACP with system prompt, full access, and Ultracode settings', async () => {
    const root = temporaryRoot('studio-acp-claude-')
    const log = join(root, 'acp.jsonl')
    const harness = new AcpClaudeHarness('/opt/claude-test', fakeAcpAgent(root))

    const result = await harness.run({
      root,
      prompt: 'continue',
      appendSystemPrompt: 'Studio protocol',
      sessionId: 'parent-session',
      model: 'studio-model',
      effort: 'ultracode',
      access: 'full',
      env: {
        FAKE_ACP_LOG: log,
        FAKE_ACP_PROVIDER: 'claude',
        DOMAIN_STUDIO_CLAUDE_ARGS: '--debug-file trace.log',
      },
      signal: new AbortController().signal,
      onEvent: () => {},
    })

    expect(result).toMatchObject({
      sessionId: 'parent-session',
      finalText: 'Hello world',
      isError: false,
    })
    const entries = readLog(log)
    expect(entries[0].env).toMatchObject({ CLAUDE_CODE_EXECUTABLE: '/opt/claude-test' })
    const requests = messages(log)
    const resumed = requests.find((message) => message.method === 'session/resume')!
    expect(resumed.params!._meta).toMatchObject({
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: 'Studio protocol',
      },
      claudeCode: {
        options: {
          extraArgs: {
            'debug-file': 'trace.log',
            settings: '{"ultracode":true}',
          },
        },
      },
    })
    expect(requests.find((message) => message.method === 'session/set_mode')!.params).toMatchObject(
      {
        sessionId: 'parent-session',
        modeId: 'bypassPermissions',
      },
    )
    // `ultracode` is Studio's own rung — the session goes to the heaviest level the
    // agent DOES report, and the flag above carries the rest
    const configs = requests.filter((message) => message.method === 'session/set_config_option')
    expect(configs.map((message) => [message.params!.configId, message.params!.value])).toEqual([
      ['model', 'studio-model'],
      ['effort', 'max'],
    ])
  })

  test('a model with no reasoning ladder is left alone instead of failing the turn', async () => {
    const root = temporaryRoot('studio-acp-no-effort-')
    const log = join(root, 'acp.jsonl')
    const harness = new AcpCodexHarness('/opt/codex-test', fakeAcpAgent(root))

    const result = await harness.run({
      root,
      prompt: 'think about it',
      model: 'studio-model',
      effort: 'max',
      access: 'workspace',
      env: { FAKE_ACP_LOG: log, FAKE_ACP_PROVIDER: 'codex', FAKE_ACP_NO_EFFORT: '1' },
      signal: new AbortController().signal,
      onEvent: () => {},
    })

    expect(result.isError).toBe(false)
    const configs = messages(log).filter(
      (message) => message.method === 'session/set_config_option',
    )
    expect(configs.map((message) => message.params!.configId)).toEqual(['model'])
  })

  test('forks Claude Ask sessions, but creates a fresh ephemeral Codex Ask when fork is unavailable', async () => {
    const claudeRoot = temporaryRoot('studio-acp-ask-claude-')
    const claudeLog = join(claudeRoot, 'acp.jsonl')
    const claudeDeltas: string[] = []
    const claude = await new AcpClaudeHarness('/opt/claude', fakeAcpAgent(claudeRoot)).ask({
      root: claudeRoot,
      prompt: 'side question',
      sessionId: 'parent-session',
      access: 'workspace',
      env: { FAKE_ACP_LOG: claudeLog, FAKE_ACP_PROVIDER: 'claude' },
      signal: new AbortController().signal,
      onDelta: (text) => claudeDeltas.push(text),
    })
    expect(claude).toEqual({ text: 'Hello world', isError: false, errorMessage: undefined })
    expect(claudeDeltas).toEqual(['Hello', ' world'])
    const claudeMethods = messages(claudeLog).flatMap((message) =>
      message.method ? [message.method] : [],
    )
    expect(claudeMethods).toContain('session/fork')
    expect(claudeMethods).not.toContain('session/resume')
    expect(claudeMethods.at(-1)).toBe('session/delete')

    const codexRoot = temporaryRoot('studio-acp-ask-codex-')
    const codexLog = join(codexRoot, 'acp.jsonl')
    const codex = await new AcpCodexHarness('/opt/codex', fakeAcpAgent(codexRoot)).ask({
      root: codexRoot,
      prompt: 'side question',
      sessionId: 'parent-session',
      access: 'workspace',
      env: {
        FAKE_ACP_LOG: codexLog,
        FAKE_ACP_PROVIDER: 'codex',
        FAKE_ACP_FORK: '0',
      },
      signal: new AbortController().signal,
      onDelta: () => {},
    })
    expect(codex).toMatchObject({ text: 'Hello world', isError: false })
    const codexMethods = messages(codexLog).flatMap((message) =>
      message.method ? [message.method] : [],
    )
    expect(codexMethods).not.toContain('session/fork')
    expect(codexMethods).not.toContain('session/resume')
    expect(codexMethods).toContain('session/new')
    expect(codexMethods.at(-1)).toBe('session/delete')
  })

  test('marks rejected resumes and preserves partial Ask failures without retrying', async () => {
    const resumeRoot = temporaryRoot('studio-acp-resume-')
    const resume = await new AcpCodexHarness('/opt/codex', fakeAcpAgent(resumeRoot)).run({
      root: resumeRoot,
      prompt: 'continue',
      sessionId: 'missing-session',
      env: { FAKE_ACP_PROVIDER: 'codex' },
      signal: new AbortController().signal,
      onEvent: () => {},
    })
    expect(resume).toMatchObject({
      sessionId: 'missing-session',
      isError: true,
      resumeRejected: true,
    })
    expect(resume.errorMessage).toContain('session not found')

    const askRoot = temporaryRoot('studio-acp-partial-')
    const askLog = join(askRoot, 'acp.jsonl')
    const deltas: string[] = []
    const ask = await new AcpClaudeHarness('/opt/claude', fakeAcpAgent(askRoot)).ask({
      root: askRoot,
      prompt: 'question',
      sessionId: 'parent-session',
      env: {
        FAKE_ACP_LOG: askLog,
        FAKE_ACP_PROVIDER: 'claude',
        FAKE_ACP_MODE: 'partial-fail',
      },
      signal: new AbortController().signal,
      onDelta: (text) => deltas.push(text),
    })
    expect(ask).toMatchObject({ text: 'Hello', isError: true })
    expect(ask.errorMessage).toContain('late failure')
    expect(deltas).toEqual(['Hello'])
    expect(readLog(askLog).filter((entry) => entry.type === 'boot')).toHaveLength(1)
  })

  test('cancellation sends session/cancel and kills the ACP process group', async () => {
    const root = temporaryRoot('studio-acp-cancel-')
    const log = join(root, 'acp.jsonl')
    const pidFile = join(root, 'descendant.pid')
    const controller = new AbortController()
    const resultPromise = new AcpCodexHarness('/opt/codex', fakeAcpAgent(root)).run({
      root,
      prompt: 'hang',
      access: 'workspace',
      env: {
        FAKE_ACP_LOG: log,
        FAKE_ACP_PROVIDER: 'codex',
        FAKE_ACP_MODE: 'hang',
        FAKE_DESCENDANT_PID: pidFile,
      },
      signal: controller.signal,
      onEvent: () => {},
    })
    await waitFor(() => existsSync(pidFile))
    controller.abort()
    const result = await resultPromise

    expect(result).toMatchObject({ isError: true, errorMessage: 'canceled' })
    expect(messages(log).some((message) => message.method === 'session/cancel')).toBe(true)
    const descendantPid = Number(readFileSync(pidFile, 'utf8'))
    const exited = await waitForExit(descendantPid)
    if (!exited) {
      try {
        process.kill(descendantPid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
    expect(exited).toBe(true)
  }, 10_000)
})
