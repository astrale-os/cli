import { withClientSession, type AdminConnectionOptions } from '../connection'
import { AstraleError } from '../errors'
import { validateSlug, validateName } from '../lib/validation'
import { ensureHostInstance, findHostInstance } from './instance'
import { connectHostChild } from './root'

export const HOST_OPTION = {
  flags: '--host <bookmark>',
  description: 'Create or connect a child directly on this Kernel Host',
}

export async function provisionHostChild(
  slug: string,
  host: string,
  options: AdminConnectionOptions,
  recover = false,
) {
  validateSlug(slug)
  validateName(host, 'Host bookmark')
  if (
    options.admin ||
    options.adminUrl ||
    options.domainIssuer ||
    options.instance ||
    options.url
  ) {
    throw new AstraleError(
      'HOST_TARGET_CONFLICT',
      '--host cannot be combined with another instance or Admin target.',
    )
  }
  return withClientSession(
    { ...options, instance: host },
    async (context) => {
      const instance = recover
        ? await findHostInstance(context, slug)
        : await ensureHostInstance(context, slug)
      if (!instance)
        throw new AstraleError('INSTANCE_NOT_FOUND', `Host ${host} has no child ${slug}.`)
      return connectHostChild(context, host, instance)
    },
    { principal: 'caller' },
  )
}
