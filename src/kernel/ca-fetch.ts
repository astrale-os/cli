import type { request as httpRequest } from 'node:http'

import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'

export function fetchWithCaFile(
  caFile: string,
  fallback: typeof fetch = globalThis.fetch,
): typeof fetch {
  const ca = readFileSync(caFile)
  const fallbackFetch = fallback.bind(globalThis)

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input)
    if (url.protocol !== 'https:') return fallbackFetch(input, init)
    return fetchWithNode(url, init, ca)
  }) as typeof fetch
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input
  if (typeof input === 'string') return new URL(input)
  return new URL(input.url)
}

function fetchWithNode(url: URL, init: RequestInit | undefined, ca: Buffer): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers = headersInitToRecord(init?.headers)
    const request = httpsRequest(
      url,
      {
        method: init?.method ?? 'GET',
        headers,
        ca,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        )
        response.on('end', () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 0,
              statusText: response.statusMessage,
              headers: responseHeaders(response.headers),
            }),
          )
        })
      },
    )

    request.on('error', reject)
    if (init?.signal) {
      if (init.signal.aborted)
        request.destroy(new DOMException('The operation was aborted.', 'AbortError'))
      init.signal.addEventListener(
        'abort',
        () => request.destroy(new DOMException('The operation was aborted.', 'AbortError')),
        { once: true },
      )
    }

    writeBody(request, init?.body)
      .then(() => request.end())
      .catch((error) => request.destroy(error))
  })
}

async function writeBody(
  request: ReturnType<typeof httpRequest>,
  body: BodyInit | null | undefined,
): Promise<void> {
  if (body === undefined || body === null) return
  if (typeof body === 'string') {
    request.write(body)
    return
  }
  if (body instanceof Uint8Array) {
    request.write(body)
    return
  }
  if (body instanceof ArrayBuffer) {
    request.write(Buffer.from(body))
    return
  }
  if (body instanceof Blob) {
    request.write(Buffer.from(await body.arrayBuffer()))
    return
  }
  throw new Error(`Unsupported request body type for CA-backed fetch`)
}

function headersInitToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const out: Record<string, string> = {}
    headers.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers.map(([key, value]) => [key, value]))
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]))
}

function responseHeaders(headers: import('node:http').IncomingHttpHeaders): Headers {
  const out = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const entry of value) out.append(key, entry)
    } else {
      out.set(key, value)
    }
  }
  return out
}
