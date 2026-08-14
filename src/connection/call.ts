import { call, type Call } from '@astrale-os/kernel-client'
import { Path } from '@astrale-os/sdk/graph/path'

/** Convert the CLI's untrusted text/JSON boundary into the one public Call representation. */
export function createPathCall(path: string, input: unknown): Call {
  return call(Path.parse(path), input as Parameters<typeof call>[1])
}
