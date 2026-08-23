import { afterEach, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ClaudeCodeHarness } from './adapter'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fakeClaude(root: string): string {
  const file = join(root, 'fake-claude')
  writeFileSync(
    file,
    `#!/usr/bin/env bun
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const args = process.argv.slice(2)
if (args[0] === '--version') {
  console.log('2.1.test')
  process.exit(0)
}
if (process.env.FAKE_CLAUDE_LOG) {
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args }) + '\\n')
}
const modelAt = args.indexOf('--model')
const model = modelAt >= 0 ? args[modelAt + 1] + '-resolved' : 'native-default'
const resumedAt = args.indexOf('--resume')
const session = resumedAt >= 0 ? args[resumedAt + 1] : 'fresh-session'
const send = (event) => process.stdout.write(JSON.stringify(event) + '\\n')
send({
  type: 'system',
  subtype: 'init',
  session_id: session,
  model,
  permissionMode: 'bypassPermissions',
  apiKeySource: 'none',
  cwd: process.cwd(),
  tools: ['Read', 'Edit'],
  mcp_servers: [],
  slash_commands: [],
  agents: [],
})
let prompt = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { prompt += chunk })
process.stdin.on('end', () => {
  if (prompt === '.') return setInterval(() => {}, 1000)
  if (process.env.FAKE_CLAUDE_MODE === 'no-result') process.exit(0)
  send({ type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } })
  if (process.env.FAKE_CLAUDE_MODE === 'text-then-crash') {
    console.error('crashed after text')
    process.exit(7)
  }
  if (process.env.FAKE_CLAUDE_MODE === 'result-error') {
    send({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'failed' })
    return
  }
  if (process.env.FAKE_CLAUDE_MODE === 'hang-ignore-term') {
    process.on('SIGTERM', () => {})
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
      stdio: 'ignore',
    })
    fs.writeFileSync(
      process.env.FAKE_CLAUDE_PID_LOG,
      JSON.stringify({ parent: process.pid, child: child.pid }),
    )
    return setInterval(() => {}, 1000)
  }
  send({
    type: 'result',
    subtype: 'success',
    result: 'done',
    session_id: session,
    num_turns: 1,
    usage: { input_tokens: 2, output_tokens: 3 },
  })
})
`,
  )
  chmodSync(file, 0o755)
  return file
}

function invocations(log: string): { args: string[] }[] {
  return readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition did not become true before timeout')
    await Bun.sleep(20)
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('Claude loadout probing reports and passes the Studio model override', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-claude-model-probe-'))
  roots.push(root)
  const log = join(root, 'claude.jsonl')
  const harness = new ClaudeCodeHarness(fakeClaude(root))

  const loadout = await harness.loadout(root, {
    model: 'sonnet',
    env: { FAKE_CLAUDE_LOG: log },
  })

  expect(loadout).toMatchObject({
    ok: true,
    model: 'sonnet-resolved',
    modelSource: 'studio',
  })
  const args = invocations(log)[0].args
  const modelAt = args.indexOf('--model')
  expect(args.slice(modelAt, modelAt + 2)).toEqual(['--model', 'sonnet'])

  await harness.loadout(root, {
    model: 'sonnet',
    env: { FAKE_CLAUDE_LOG: log },
  })
  expect(invocations(log)).toHaveLength(1)
  await harness.loadout(root, {
    model: 'sonnet',
    env: { FAKE_CLAUDE_LOG: log },
    refresh: true,
  })
  expect(invocations(log)).toHaveLength(2)
})

test('Claude turns and Ask calls carry selected models and native effort modes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-claude-model-turns-'))
  roots.push(root)
  const log = join(root, 'claude.jsonl')
  const harness = new ClaudeCodeHarness(fakeClaude(root))
  const signal = new AbortController().signal

  const normal = await harness.run({
    root,
    prompt: 'normal turn',
    model: 'sonnet',
    effort: 'ultracode',
    access: 'full',
    env: { FAKE_CLAUDE_LOG: log },
    signal,
    onEvent: () => {},
  })
  expect(normal).toMatchObject({
    sessionId: 'fresh-session',
    finalText: 'done',
    isError: false,
  })

  const resumed = await harness.run({
    root,
    prompt: 'resumed turn',
    sessionId: 'parent-session',
    model: 'opus',
    effort: 'max',
    access: 'full',
    env: { FAKE_CLAUDE_LOG: log },
    signal,
    onEvent: () => {},
  })
  expect(resumed).toMatchObject({
    sessionId: 'parent-session',
    finalText: 'done',
    isError: false,
  })

  const fresh = await harness.ask({
    root,
    prompt: 'fresh ask',
    model: 'fable',
    effort: 'max',
    access: 'workspace',
    env: { FAKE_CLAUDE_LOG: log },
    signal,
    onDelta: () => {},
  })
  const forked = await harness.ask({
    root,
    prompt: 'forked ask',
    sessionId: 'parent-session',
    model: 'sonnet',
    effort: 'max',
    access: 'workspace',
    env: { FAKE_CLAUDE_LOG: log },
    signal,
    onDelta: () => {},
  })
  expect(fresh).toEqual({ text: 'done', isError: false })
  expect(forked).toEqual({ text: 'done', isError: false })

  const [normalArgs, resumedArgs, freshArgs, forkArgs] = invocations(log).map((entry) => entry.args)
  expect(normalArgs).not.toContain('--resume')
  expect(
    normalArgs.slice(normalArgs.indexOf('--model'), normalArgs.indexOf('--model') + 2),
  ).toEqual(['--model', 'sonnet'])
  expect(
    resumedArgs.slice(resumedArgs.indexOf('--resume'), resumedArgs.indexOf('--resume') + 2),
  ).toEqual(['--resume', 'parent-session'])
  expect(
    resumedArgs.slice(resumedArgs.indexOf('--model'), resumedArgs.indexOf('--model') + 2),
  ).toEqual(['--model', 'opus'])
  expect(freshArgs.slice(freshArgs.indexOf('--model'), freshArgs.indexOf('--model') + 2)).toEqual([
    '--model',
    'fable',
  ])
  expect(freshArgs).not.toContain('--resume')
  expect(forkArgs.slice(forkArgs.indexOf('--model'), forkArgs.indexOf('--model') + 2)).toEqual([
    '--model',
    'sonnet',
  ])
  expect(forkArgs.slice(forkArgs.indexOf('--resume'), forkArgs.indexOf('--resume') + 3)).toEqual([
    '--resume',
    'parent-session',
    '--fork-session',
  ])
  const normalEffortAt = normalArgs.indexOf('--effort')
  expect(normalArgs.slice(normalEffortAt, normalEffortAt + 2)).toEqual(['--effort', 'xhigh'])
  const settingsAt = normalArgs.indexOf('--settings')
  expect(normalArgs.slice(settingsAt, settingsAt + 2)).toEqual(['--settings', '{"ultracode":true}'])
  expect(normalArgs).not.toContain('ultracode')

  for (const args of [resumedArgs, freshArgs, forkArgs]) {
    const effortAt = args.indexOf('--effort')
    expect(args.slice(effortAt, effortAt + 2)).toEqual(['--effort', 'max'])
  }
})

test('Claude turns and Ask reject incomplete terminal protocols', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-claude-terminal-'))
  roots.push(root)
  const harness = new ClaudeCodeHarness(fakeClaude(root))
  const input = {
    root,
    prompt: 'work',
    signal: new AbortController().signal,
    onEvent: () => {},
  }

  const noResult = await harness.run({
    ...input,
    env: { FAKE_CLAUDE_MODE: 'no-result' },
  })
  expect(noResult).toMatchObject({
    isError: true,
    errorMessage: 'claude exited without a result event',
  })

  const crashed = await harness.run({
    ...input,
    env: { FAKE_CLAUDE_MODE: 'text-then-crash' },
  })
  expect(crashed).toMatchObject({
    isError: true,
    errorMessage: expect.stringContaining('claude exited 7'),
  })

  const askInput = {
    root,
    prompt: 'question',
    signal: new AbortController().signal,
    onDelta: () => {},
  }
  const askNoResult = await harness.ask({
    ...askInput,
    env: { FAKE_CLAUDE_MODE: 'no-result' },
  })
  expect(askNoResult).toMatchObject({
    isError: true,
    errorMessage: 'claude exited without a result event',
  })

  const askCrashed = await harness.ask({
    ...askInput,
    env: { FAKE_CLAUDE_MODE: 'text-then-crash' },
  })
  expect(askCrashed).toMatchObject({
    isError: true,
    errorMessage: expect.stringContaining('claude exited 7'),
  })

  const askTerminalError = await harness.ask({
    ...askInput,
    env: { FAKE_CLAUDE_MODE: 'result-error' },
  })
  expect(askTerminalError).toEqual({
    text: 'failed',
    isError: true,
    errorMessage: 'error_during_execution',
  })
})

test('Claude Ask cancellation kills the entire stubborn subprocess group', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-claude-ask-cancel-'))
  roots.push(root)
  const pidLog = join(root, 'pids.json')
  const controller = new AbortController()
  const resultPromise = new ClaudeCodeHarness(fakeClaude(root)).ask({
    root,
    prompt: 'question',
    env: {
      FAKE_CLAUDE_MODE: 'hang-ignore-term',
      FAKE_CLAUDE_PID_LOG: pidLog,
    },
    signal: controller.signal,
    onDelta: () => {},
  })

  let pids: { parent: number; child: number } | undefined
  await waitFor(() => {
    if (!existsSync(pidLog)) return false
    try {
      pids = JSON.parse(readFileSync(pidLog, 'utf8')) as { parent: number; child: number }
      return Number.isInteger(pids.parent) && Number.isInteger(pids.child)
    } catch {
      return false
    }
  })
  if (!pids) throw new Error('fake Claude did not publish complete process evidence')
  const processIds = pids
  expect(processExists(processIds.parent)).toBe(true)
  expect(processExists(processIds.child)).toBe(true)
  controller.abort()

  expect(await resultPromise).toEqual({
    text: '',
    isError: true,
    errorMessage: 'canceled',
  })
  await waitFor(() => !processExists(processIds.parent) && !processExists(processIds.child))
})
