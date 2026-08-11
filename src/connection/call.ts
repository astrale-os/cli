import { pathCall, type Call } from '@astrale-os/kernel-client'
import { Path } from '@astrale-os/kernel-core/path'

/** Convert the CLI's untrusted text/JSON boundary into the one public Call representation. */
export function createPathCall(path: string, input: unknown): Call {
  return pathCall(Path.parse(path), input as Parameters<typeof pathCall>[1])
}
