import type { SessionRouteArtifact, SessionRouteStore } from '@astrale-os/sdk/client/session'

import { chmodSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'

import { atomicWriteSync } from './files'
import { SESSION_ROUTES_PATH } from './paths'

/** CLI filesystem representation for Kernel Client's admitted confidential route artifact. */
export class FileSessionRouteStore implements SessionRouteStore {
  constructor(private readonly path = SESSION_ROUTES_PATH) {}

  read(): unknown {
    return JSON.parse(readFileSync(this.path, 'utf8')) as unknown
  }

  write(artifact: SessionRouteArtifact): void {
    const directory = dirname(this.path)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    chmodSync(directory, 0o700)
    atomicWriteSync(this.path, `${JSON.stringify(artifact)}\n`)
    chmodSync(this.path, 0o600)
  }

  clear(): void {
    try {
      unlinkSync(this.path)
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== 'ENOENT') throw error
    }
  }
}

export const SESSION_ROUTE_STORE = Object.freeze(new FileSessionRouteStore())
