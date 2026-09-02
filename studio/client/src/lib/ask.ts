import type { AnchorRef } from '@shared/types'

export interface AskStreamResult {
  text: string
  error?: string
}

/**
 * POST a quick "side question" and stream the newline-delimited JSON answer
 * (`{delta}` chunks, then a final `{done}` or `{error}`). Calls `onDelta` as text
 * arrives and resolves with the final text. Pass an AbortSignal to cancel — the
 * server kills the forked agent when the request aborts.
 */
export async function streamAsk(
  domainId: string,
  body: { anchor: AnchorRef; excerpt: string; question: string },
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<AskStreamResult> {
  const res = await fetch('/api/agent/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, domainId }),
    signal,
  })
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => res.statusText)
    return { text: '', error: `${res.status} ${t}`.trim() }
  }

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let finalText = ''
  let error: string | undefined

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        const o = JSON.parse(line)
        if (typeof o.delta === 'string') onDelta(o.delta)
        else if (typeof o.done === 'string') finalText = o.done
        else if (o.error) error = String(o.error)
      } catch {
        /* ignore a partial line */
      }
    }
  }
  return { text: finalText, error }
}
