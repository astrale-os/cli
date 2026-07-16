#!/usr/bin/env bun
/**
 * bridge/stdio.ts — the stdio MCP server spawned by local harnesses. It exposes
 * the Domain Studio write-back tools from the generated MCP configuration and
 * forwards each call to the token-guarded HTTP bridge (api → agent/bridge/*),
 * so an agent can reply to comment threads and post progress AS IT WORKS.
 *
 * Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout. Nothing but
 * protocol messages may touch stdout; diagnostics go to stderr.
 */
import { readFileSync } from 'node:fs'

import { forwardBridgeTool } from './client'

function configFromArgv(): { base?: string; token?: string } {
  const i = process.argv.indexOf('--config')
  const path = i >= 0 ? process.argv[i + 1] : undefined
  if (!path) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as { base?: string; token?: string }
  } catch {
    return {}
  }
}

const config = configFromArgv()
const BASE = config.base || process.env.DOMAIN_STUDIO_BRIDGE_URL || ''
const TOKEN = config.token || process.env.DOMAIN_STUDIO_BRIDGE_TOKEN || ''

const TOOLS = [
  {
    name: 'list_open_threads',
    description:
      'List the open comment threads that are awaiting your reply (id, anchor, file, latest message). Call this first to see what to address.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    route: 'threads',
  },
  {
    name: 'reply_to_thread',
    description:
      'Post a reply to one comment thread so the user sees it live. Say what you changed, answer a question, or ask one back. Pass `options` (a short list of concrete choices) to turn the reply into a multiple-choice question the user can pick from (or answer freely). Set resolve=true with a short closeNote ONLY when fully handled — never resolve a question you just asked.',
    inputSchema: {
      type: 'object',
      properties: {
        commentId: { type: 'string', description: 'the thread id from list_open_threads' },
        text: {
          type: 'string',
          description: 'your reply (concise — a framing line when offering options)',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '2–5 short choices for the user to pick from; they may also answer freely',
        },
        resolve: { type: 'boolean', description: 'close the thread when done (not when asking)' },
        closeNote: { type: 'string', description: 'one-line summary when resolving' },
      },
      required: ['commentId', 'text'],
      additionalProperties: false,
    },
    route: 'reply',
  },
  {
    name: 'resolve_thread',
    description: 'Mark a comment thread resolved (closed) with an optional closeNote.',
    inputSchema: {
      type: 'object',
      properties: { commentId: { type: 'string' }, closeNote: { type: 'string' } },
      required: ['commentId'],
      additionalProperties: false,
    },
    route: 'resolve',
  },
  {
    name: 'post_progress',
    description:
      'Post a short progress note shown in the studio activity panel (not tied to a thread).',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    route: 'progress',
  },
  {
    name: 'raise_question',
    description:
      'Open a NEW question thread anchored to a schema element (ref like "class.Monitor.property.url") when you need the user to decide something. Pass `options` for a multiple-choice question — the user picks one or answers freely.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: 'anchor ref, e.g. "class.Order" or "module.inventory/inventory"',
        },
        text: {
          type: 'string',
          description: 'the question (one framing line when offering options)',
        },
        file: { type: 'string' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '2–5 short choices the user can pick from',
        },
      },
      required: ['ref', 'text'],
      additionalProperties: false,
    },
    route: 'raise_question',
  },
] as const

function send(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}
function reply(id: unknown, result: unknown): void {
  send({ jsonrpc: '2.0', id, result })
}
function replyError(id: unknown, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(req: any): Promise<void> {
  const { id, method, params } = req
  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'domain-studio', version: '0.1.0' },
      })
      return
    case 'notifications/initialized':
    case 'initialized':
      return // notification, no response
    case 'ping':
      reply(id, {})
      return
    case 'tools/list':
      reply(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      })
      return
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name)
      if (!tool) {
        replyError(id, -32602, `unknown tool: ${params?.name}`)
        return
      }
      const result = await forwardBridgeTool(
        BASE,
        TOKEN,
        tool.route,
        (params?.arguments ?? {}) as Record<string, unknown>,
      )
      reply(id, result)
      return
    }
    default:
      if (id !== undefined) replyError(id, -32601, `method not found: ${method}`)
  }
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buf += chunk
  let nl: number
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let req: any
    try {
      req = JSON.parse(line)
    } catch {
      continue
    }
    void handle(req)
  }
})
process.stdin.on('end', () => process.exit(0))
