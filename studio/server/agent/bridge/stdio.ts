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

import { asJsonRecord, asString, parseJson } from '../../json'
import { forwardBridgeTool } from './client'
import { BRIDGE_TOOLS } from './tools'

function configFromArgv(): { base?: string; token?: string } {
  const i = process.argv.indexOf('--config')
  const path = i >= 0 ? process.argv[i + 1] : undefined
  if (!path) return {}
  try {
    const record = asJsonRecord(parseJson(readFileSync(path, 'utf8')))
    const base = asString(record?.base)
    const token = asString(record?.token)
    return {
      ...(base === undefined ? {} : { base }),
      ...(token === undefined ? {} : { token }),
    }
  } catch {
    return {}
  }
}

const config = configFromArgv()
const BASE = config.base || process.env.DOMAIN_STUDIO_BRIDGE_URL || ''
const TOKEN = config.token || process.env.DOMAIN_STUDIO_BRIDGE_TOKEN || ''

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
        tools: BRIDGE_TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      })
      return
    case 'tools/call': {
      const tool = BRIDGE_TOOLS.find((t) => t.name === params?.name)
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
