/**
 * agent/workspace.ts — the unit the agent works in.
 *
 * There is no "active domain": the agent's working directory is the workspace the
 * studio was pointed at, and every domain in it is within reach. What it needs to know
 * about them — where each one is, what it is called, which threads wait there — is
 * gathered here once per call, from the registry as it stands, so a domain created
 * during a conversation is part of the next turn.
 */
import { relative, resolve } from 'node:path'

import type { DomainHandle } from '../domain'

import { allDomains } from '../domain'
import { agentStateRoot, workspaceKey, workspaceStateRoot } from '../home'
import { workspaceRoot } from '../workspace-state'

export interface AgentWorkspace {
  /** the scanned root — the agent's cwd, and what every relative path below is from */
  root: string
  /** the machine-wide folder holding every chat, transcript and harness session id */
  stateRoot: string
  /** machine-side UI state belonging only to this scanned root */
  uiRoot: string
  key: string
  domains: DomainHandle[]
}

/** The workspace as it stands now: the root the studio scans, and every domain in it. */
export function agentWorkspace(): AgentWorkspace {
  const root = resolve(workspaceRoot() || process.cwd())
  return {
    root,
    stateRoot: agentStateRoot(),
    uiRoot: workspaceStateRoot(root),
    key: workspaceKey(root),
    domains: allDomains(),
  }
}

/** What a domain is called — its origin once it has been read, its folder until then. */
export function domainOrigin(handle: DomainHandle): string {
  return handle.origin ?? handle.id
}

/** Where a domain sits under the workspace, as the agent will `cd` into it. */
export function domainRelativePath(workspace: Pick<AgentWorkspace, 'root'>, handle: DomainHandle) {
  const rel = relative(workspace.root, handle.root).replaceAll('\\', '/')
  return rel === '' ? '.' : rel.startsWith('.') ? rel : `./${rel}`
}

/**
 * The domain an agent named: by origin, by id, or by the path it was given. The bridge
 * tools take any of the three, because the agent reads all of them in its turn.
 */
export function findDomain(
  workspace: Pick<AgentWorkspace, 'root' | 'domains'>,
  reference: string,
): DomainHandle | undefined {
  const wanted = reference.trim()
  if (!wanted) return undefined
  const normalized = wanted.replace(/\/+$/, '')
  return workspace.domains.find(
    (handle) =>
      domainOrigin(handle) === normalized ||
      handle.id === normalized ||
      domainRelativePath(workspace, handle) === normalized ||
      domainRelativePath(workspace, handle) === `./${normalized}` ||
      resolve(workspace.root, normalized) === handle.root,
  )
}
