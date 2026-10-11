import { UiError, type UiErrorCode } from './model'

export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super('HTTP ' + status)
  }
}

/** One GET whose body may not exceed `maxBytes`; every failure is a `code` UiError. */
export async function fetchBounded(
  fetcher: typeof fetch,
  url: string,
  options: { label: string; code: UiErrorCode; maxBytes: number; accept?: string },
): Promise<Buffer> {
  const { label, code, maxBytes } = options
  let response: Response
  try {
    response = await fetcher(url, { headers: { accept: options.accept ?? 'application/json' } })
  } catch (cause) {
    throw new UiError(code, `Unable to reach ${label}.`, undefined, { cause })
  }
  if (!response.ok) {
    throw new UiError(code, `${label} returned HTTP ${response.status}.`, undefined, {
      cause: new HttpStatusError(response.status),
    })
  }
  const tooLarge = () => new UiError(code, `${label} exceeds the supported response size.`)
  if (Number(response.headers.get('content-length')) > maxBytes) throw tooLarge()
  if (!response.body) throw new UiError(code, `${label} returned an empty response.`)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (;;) {
    const result = await reader.read()
    if (result.done) break
    bytes += result.value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(result.value)
  }
  return Buffer.concat(chunks, bytes)
}

export async function fetchJson<T>(
  fetcher: typeof fetch,
  url: string,
  options: { label: string; code: UiErrorCode; maxBytes: number },
): Promise<T> {
  const body = await fetchBounded(fetcher, url, options)
  try {
    return JSON.parse(body.toString('utf8')) as T
  } catch (cause) {
    throw new UiError(options.code, `${options.label} returned malformed JSON.`, undefined, {
      cause,
    })
  }
}
