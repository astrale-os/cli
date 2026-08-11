export interface BridgeToolResult {
  content: [{ type: 'text'; text: string }]
  isError?: true
}

type FetchBridge = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function result(text: string, isError = false): BridgeToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true as const } : {}),
  }
}

/** Forward one stdio MCP tool call to the authenticated Studio bridge. */
export async function forwardBridgeTool(
  base: string,
  token: string,
  route: string,
  args: Record<string, unknown>,
  fetchBridge: FetchBridge = fetch,
): Promise<BridgeToolResult> {
  if (!base || !token) return result('bridge not configured', true)
  try {
    const response = await fetchBridge(`${base}/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...args, token }),
    })
    const text = await response.text()
    return response.ok
      ? result(text || 'ok')
      : result(`bridge error ${response.status}: ${text}`, true)
  } catch (error: any) {
    return result(`bridge call failed: ${error?.message ?? error}`, true)
  }
}
