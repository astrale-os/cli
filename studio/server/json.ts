/** Pure structural helpers for JSON trust boundaries. */

export type JsonRecord = Record<string, unknown>
export type JsonDecoder<T> = (value: unknown) => T | undefined

export function asJsonRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}

export function asJsonArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined
}

export function asStringRecord(value: unknown): Record<string, string> | undefined {
  const record = asJsonRecord(value)
  if (!record || Object.values(record).some((item) => typeof item !== 'string')) return undefined
  return record as Record<string, string>
}

/** Parse JSON as untrusted data. `undefined` means syntax failure. */
export function parseJson(text: string): unknown | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    return undefined
  }
}
