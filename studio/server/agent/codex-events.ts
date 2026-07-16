import type { AgentStreamEvent } from './types'

export interface CodexRunState {
  sessionId?: string
  finalText: string
  tokens?: number
  isError: boolean
  errorMessage?: string
  startedItems: Set<string>
}

export function newCodexRunState(sessionId?: string): CodexRunState {
  return { sessionId, finalText: '', isError: false, startedItems: new Set() }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function fileChangeTarget(item: any): string {
  const paths = Array.isArray(item?.changes)
    ? item.changes
        .map((change: any) => text(change?.path ?? change?.file ?? change?.file_path))
        .filter(Boolean)
    : []
  return paths.slice(0, 3).join(', ')
}

function toolEvent(item: any): AgentStreamEvent | null {
  switch (item?.type) {
    case 'command_execution':
      return {
        kind: 'tool',
        text: 'Shell',
        tool: 'Shell',
        target: text(item.command).slice(0, 200),
      }
    case 'file_change':
      return {
        kind: 'tool',
        text: 'Edit',
        tool: 'Edit',
        target: fileChangeTarget(item),
      }
    case 'mcp_tool_call':
      return {
        kind: 'tool',
        text: text(item.tool) || 'MCP',
        tool: `${text(item.server)}:${text(item.tool)}`.replace(/^:/, ''),
        target: text(item.tool),
      }
    case 'web_search':
      return {
        kind: 'tool',
        text: 'Web search',
        tool: 'WebSearch',
        target: text(item.query),
      }
    case 'plan':
      return { kind: 'status', text: text(item.text) || 'plan updated' }
    default:
      return null
  }
}

/** Normalize one `codex exec --json` JSONL record into Studio's compact event
 * contract while accumulating the final result and usage. */
export function handleCodexExecEvent(
  event: any,
  state: CodexRunState,
  onEvent: (event: AgentStreamEvent) => void,
): void {
  switch (event?.type) {
    case 'thread.started':
      if (typeof event.thread_id === 'string') state.sessionId = event.thread_id
      onEvent({ kind: 'status', text: 'session started' })
      return
    case 'item.started': {
      const normalized = toolEvent(event.item)
      if (normalized) {
        if (typeof event.item?.id === 'string') state.startedItems.add(event.item.id)
        onEvent(normalized)
      }
      return
    }
    case 'item.completed': {
      const item = event.item
      if (item?.type === 'agent_message' && text(item.text).trim()) {
        state.finalText = item.text
        onEvent({ kind: 'message', text: item.text.trim() })
      } else if (item?.type === 'reasoning') {
        const reasoning =
          text(item.text) ||
          (Array.isArray(item.summary)
            ? item.summary.filter((part: unknown) => typeof part === 'string').join('\n')
            : '')
        if (reasoning.trim()) onEvent({ kind: 'thinking', text: reasoning.trim() })
      } else if (!state.startedItems.has(item?.id)) {
        const normalized = toolEvent(item)
        if (normalized) onEvent(normalized)
      }
      return
    }
    case 'turn.completed': {
      const usage = event.usage
      if (usage && typeof usage === 'object')
        state.tokens = Number(usage.input_tokens ?? 0) + Number(usage.output_tokens ?? 0)
      return
    }
    case 'turn.failed':
      state.isError = true
      state.errorMessage =
        text(event.error?.message) ||
        text(event.message) ||
        text(event.error) ||
        'Codex turn failed'
      return
    case 'error':
      state.isError = true
      state.errorMessage =
        text(event.message) || text(event.error?.message) || text(event.error) || 'Codex error'
  }
}
