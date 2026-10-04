/**
 * Strict local decoders shared by the Fleet catalog adapters: every Admin result is admitted here
 * before it reaches a command.
 *
 * @deprecated Successor and removal: see `./client.ts`.
 */
import { Path } from '@astrale-os/sdk/graph/path'

export function requiredString(input: unknown, label: string): string {
  if (typeof input !== 'string' || input.length === 0) throw new TypeError(`${label} is invalid.`)
  return input
}

export function requiredNodePath(input: unknown, label: string): string {
  const value = requiredString(input, label)
  try {
    return Path.parse(value).raw
  } catch {
    throw new TypeError(`${label} is invalid.`)
  }
}

export function record(input: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} is invalid.`)
  }
  return input as Readonly<Record<string, unknown>>
}
