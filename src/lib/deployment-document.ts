const MAXIMUM_DOCUMENT_BYTES = 1024 * 1024

/** Read one deployment document body, refusing more than `maximum` bytes (one MiB by default). */
export async function readBounded(
  response: Response,
  url: URL,
  maximum: number = MAXIMUM_DOCUMENT_BYTES,
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) ||
      !Number.isSafeInteger(Number(declared)) ||
      Number(declared) > maximum)
  ) {
    await cancel(response.body)
    throw sizeError(url, maximum)
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
      if (next.value.byteLength > maximum - size) {
        throw sizeError(url, maximum)
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

function sizeError(url: URL, maximum: number): Error {
  return new Error(`GET ${url.href} exceeded ${maximum} bytes`)
}

export async function cancel(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (body !== null) await body.cancel().catch(() => undefined)
}
