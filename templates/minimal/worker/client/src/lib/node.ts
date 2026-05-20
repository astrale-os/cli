import type { Shell } from '@astrale-os/shell'

import { useEffect, useState } from 'react'

/**
 * Prop key constants — the graph stores props with fully-qualified keys
 * (cf `kernel/core/domain/accessors/flatten.ts`). Add entries here when
 * a renderer needs a specific prop — centralizes the keys so schema
 * renames don't silently break renderers.
 */
export const PROP = {
  named: {
    name: 'kernel.astrale.ai:interface.Named.property.name',
  },
} as const

export type KernelNode = {
  id: string
  path: string
  class: string | { raw?: string }
  props: Record<string, unknown>
}

export function readProp(props: Record<string, unknown>, key: string): string | undefined {
  const v = props[key]
  return typeof v === 'string' ? v : undefined
}

export function classOf(node: KernelNode): string | undefined {
  if (typeof node.class === 'string') return node.class
  return node.class?.raw
}

/** Short class name from a `class.raw` path `/:<domain>:class.<Name>` → `<Name>`. */
export function classShortName(node: KernelNode): string {
  const raw = classOf(node) ?? ''
  const parts = raw.split(':')
  const last = parts[parts.length - 1] ?? ''
  const dot = last.indexOf('.')
  return dot >= 0 ? last.slice(dot + 1) : last
}

export type NodeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; node: KernelNode }
  | { status: 'error'; message: string }

/**
 * Fetch + subscribe to a node by id via `@<id>::get`. Re-fetches when
 * `nodeId` changes (hot-swap).
 */
export function useNode(shell: Shell | null, nodeId: string | undefined): NodeState {
  const [state, setState] = useState<NodeState>({ status: 'idle' })
  useEffect(() => {
    if (!shell || !nodeId) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    shell.kernel
      .call(`@${nodeId}::get`, {})
      .then((r) => {
        if (!cancelled) setState({ status: 'ok', node: r as KernelNode })
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: e instanceof Error ? e.message : String(e),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [shell, nodeId])
  return state
}
