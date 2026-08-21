import { publication } from '@astrale-os/kernel-protocol'

const MAXIMUM_PUBLICATION_BYTES = 1024 * 1024
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Fetch and admit one canonical Domain Publication without following its bundle. */
export async function fetchDomainPublication(
  input: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<publication.Publication> {
  const root = deploymentRoot(input)
  const url = new URL(publication.PATH, root)
  const response = await fetchImpl(url, {
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) {
    await cancel(response.body)
    throw new Error(`GET ${url.href} → ${response.status}`)
  }
  const bytes = await readBounded(response, url)
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return publication.accept(JSON.parse(source) as unknown)
  } catch (cause) {
    throw new Error(`GET ${url.href} returned an invalid Domain Publication`, { cause })
  }
}

async function readBounded(response: Response, url: URL): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) ||
      !Number.isSafeInteger(Number(declared)) ||
      Number(declared) > MAXIMUM_PUBLICATION_BYTES)
  ) {
    await cancel(response.body)
    throw sizeError(url)
  }
  if (response.body === null) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let complete = false
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) {
        complete = true
        break
      }
      if (next.value.byteLength === 0) continue
      if (next.value.byteLength > MAXIMUM_PUBLICATION_BYTES - size) {
        throw sizeError(url)
      }
      chunks.push(next.value)
      size += next.value.byteLength
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function sizeError(url: URL): Error {
  return new Error(`GET ${url.href} exceeded ${MAXIMUM_PUBLICATION_BYTES} bytes`)
}

async function cancel(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (body !== null) await body.cancel().catch(() => undefined)
}

function deploymentRoot(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new TypeError(`Domain deployment URL is invalid: ${input}`)
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    !['', '/'].includes(url.pathname)
  ) {
    throw new TypeError(`Domain deployment URL must be an HTTP(S) origin: ${input}`)
  }
  return new URL(url.origin)
}
