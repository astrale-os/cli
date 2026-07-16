import { afterEach, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ClaudeCodeHarness } from './claude'

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
  send({ type: 'assistant', message: { content: [{ type: 'text', text: 'answer' }] } })
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

test('Claude loadout probing reports and passes the Studio model override', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-claude-model-probe-'))
  roots.push(root)
  const log = join(root, 'claude.jsonl')

  const loadout = await new ClaudeCodeHarness(fakeClaude(root)).loadout(root, {
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
})

test('Claude resumed turns and fresh or forked Ask calls carry their selected model', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-claude-model-turns-'))
  roots.push(root)
  const log = join(root, 'claude.jsonl')
  const harness = new ClaudeCodeHarness(fakeClaude(root))
  const signal = new AbortController().signal

  const run = await harness.run({
    root,
    prompt: 'main turn',
    sessionId: 'parent-session',
    model: 'opus',
    effort: 'high',
    access: 'full',
    env: { FAKE_CLAUDE_LOG: log },
    signal,
    onEvent: () => {},
  })
  expect(run).toMatchObject({
    sessionId: 'parent-session',
    finalText: 'done',
    isError: false,
  })

  const fresh = await harness.ask({
    root,
    prompt: 'fresh ask',
    model: 'fable',
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
    access: 'workspace',
    env: { FAKE_CLAUDE_LOG: log },
    signal,
    onDelta: () => {},
  })
  expect(fresh).toEqual({ text: 'done', isError: false })
  expect(forked).toEqual({ text: 'done', isError: false })

  const [runArgs, freshArgs, forkArgs] = invocations(log).map((entry) => entry.args)
  expect(runArgs.slice(runArgs.indexOf('--resume'), runArgs.indexOf('--resume') + 2)).toEqual([
    '--resume',
    'parent-session',
  ])
  expect(runArgs.slice(runArgs.indexOf('--model'), runArgs.indexOf('--model') + 2)).toEqual([
    '--model',
    'opus',
  ])
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
})
