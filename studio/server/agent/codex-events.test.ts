import { describe, expect, test } from 'bun:test'

import { handleCodexExecEvent, newCodexRunState } from './codex-events'

describe('Codex exec JSONL normalization', () => {
  test('captures session, activity, final text, and non-duplicated token usage', () => {
    const state = newCodexRunState()
    const events: any[] = []
    const onEvent = (event: any) => events.push(event)

    handleCodexExecEvent({ type: 'thread.started', thread_id: '019f-test-thread' }, state, onEvent)
    handleCodexExecEvent(
      {
        type: 'item.started',
        item: { id: 'cmd-1', type: 'command_execution', command: 'pnpm typecheck' },
      },
      state,
      onEvent,
    )
    handleCodexExecEvent(
      {
        type: 'item.completed',
        item: { id: 'cmd-1', type: 'command_execution', command: 'pnpm typecheck' },
      },
      state,
      onEvent,
    )
    handleCodexExecEvent(
      {
        type: 'item.completed',
        item: { id: 'msg-1', type: 'agent_message', text: 'Done.' },
      },
      state,
      onEvent,
    )
    handleCodexExecEvent(
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 100,
          cached_input_tokens: 70,
          output_tokens: 20,
          reasoning_output_tokens: 5,
        },
      },
      state,
      onEvent,
    )

    expect(state.sessionId).toBe('019f-test-thread')
    expect(state.finalText).toBe('Done.')
    expect(state.tokens).toBe(120)
    expect(events).toEqual([
      { kind: 'status', text: 'session started' },
      {
        kind: 'tool',
        text: 'Shell',
        tool: 'Shell',
        target: 'pnpm typecheck',
      },
      { kind: 'message', text: 'Done.' },
    ])
  })

  test('maps MCP calls and failures', () => {
    const state = newCodexRunState('existing')
    const events: any[] = []
    handleCodexExecEvent(
      {
        type: 'item.started',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'domain-studio',
          tool: 'reply_to_thread',
        },
      },
      state,
      (event) => events.push(event),
    )
    handleCodexExecEvent(
      { type: 'turn.failed', error: { message: 'tool failed' } },
      state,
      (event) => events.push(event),
    )

    expect(events[0]).toMatchObject({
      kind: 'tool',
      tool: 'domain-studio:reply_to_thread',
    })
    expect(state.isError).toBe(true)
    expect(state.errorMessage).toBe('tool failed')
  })
})
