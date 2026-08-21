/**
 * Kernel-operation token scan for resolved handler source files.
 */
import { readFileSync } from 'node:fs'

type KernelToken = { token: string; label?: string }

/** Kernel-op idioms surfaced as `kernelCalls`; entries are longest-first. */
const KERNEL_TOKENS: KernelToken[] = [
  { token: 'graph.createEdge' },
  { token: 'graph.removeEdge' },
  { token: 'function.mutate' },
  { token: 'graph.children' },
  { token: 'function.get' },
  { token: 'graph.create' },
  { token: 'graph.update' },
  { token: 'graph.remove' },
  { token: 'graph.mutate' },
  { token: 'auth.revoke' },
  { token: 'graph.links' },
  { token: 'auth.grant' },
  { token: 'auth.check' },
  { token: 'graph.tree' },
  { token: 'graph.node' },
  { token: 'revokePerm', label: 'revokePerm (legacy)' },
  { token: 'checkPerm', label: 'checkPerm (legacy)' },
  { token: 'graph.get' },
  { token: 'grantPerm', label: 'grantPerm (legacy)' },
]

/** Scan handler file text for kernel-op tokens. */
export function scanKernelCalls(file: string): string[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const found: string[] = []
  let work = text
  for (const entry of KERNEL_TOKENS) {
    if (work.includes(entry.token)) {
      found.push(entry.label ?? entry.token)
      // Blank out matches so `::getLinks` doesn't also count as `::getLink`.
      work = work.split(entry.token).join(' '.repeat(entry.token.length))
    }
  }
  return found
}
