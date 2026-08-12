import type { IdentityExport } from '../api.js'

interface Target {
  readonly name: string
  readonly url: string
  readonly issuer: string
}

interface ReadyChild {
  readonly target: Target
  readonly operation: string
  readonly instance: string
}

interface BootstrapAuthority {
  /** Supported identity-import boundary; never a direct State or Keys write. */
  importIdentity(input: {
    readonly name: 'platform-root'
    readonly envelope: IdentityExport
  }): Promise<void>
  bookmark(input: {
    readonly target: Target
    readonly defaultIdentity?: 'platform-root'
  }): Promise<void>
  /** Authenticated public Identity.whoami result on the selected target. */
  whoami(input: {
    readonly target: Target
    readonly as?: 'platform-root'
    readonly credential?: string
  }): Promise<{ readonly id: string }>
  /** Public manager createInstance call plus Operation and Instance status polling. */
  callCreateChild(input: {
    readonly manager: Target
    readonly as: 'platform-root'
    readonly operationId: string
    readonly slug: string
  }): Promise<ReadyChild>
  /** Public Auth delegation invoked on the manager after authenticated whoami. */
  delegateSelf(input: {
    readonly manager: Target
    readonly as: 'platform-root'
    readonly principal: string
    readonly audience: string
  }): Promise<string>
}

/**
 * Bootstrap uses the imported root directly on the manager, then an unchanged
 * manager-to-child Management carrier whose effective child principal is
 * established only by the child's authenticated whoami result.
 */
export async function bootstrapRootAndChild(
  authority: BootstrapAuthority,
  input: {
    readonly envelope: IdentityExport
    readonly manager: Target & { readonly name: 'platform-manager' }
    readonly childSlug: string
    readonly operationId: string
  },
): Promise<{ readonly managerId: string; readonly childId: string; readonly child: ReadyChild }> {
  await authority.importIdentity({ name: 'platform-root', envelope: input.envelope })
  await authority.bookmark({ target: input.manager, defaultIdentity: 'platform-root' })
  const manager = await authority.whoami({ target: input.manager, as: 'platform-root' })
  const child = await authority.callCreateChild({
    manager: input.manager,
    as: 'platform-root',
    operationId: input.operationId,
    slug: input.childSlug,
  })
  const credential = await authority.delegateSelf({
    manager: input.manager,
    as: 'platform-root',
    principal: manager.id,
    audience: child.target.issuer,
  })
  await authority.bookmark({ target: child.target })
  const effectiveChild = await authority.whoami({ target: child.target, credential })
  return { managerId: manager.id, childId: effectiveChild.id, child }
}
