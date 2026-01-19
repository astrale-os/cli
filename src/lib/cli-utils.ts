import type { AvatarId, SpaceId } from '@astrale-os/kernel-core'
import { resolveConfig, type ResolvedConfig } from './global-config'
import { KernelClient, type KernelClientConfig } from './kernel'

export type WithClientOptions = {
  profileName?: string
  requireAvatar?: boolean
  persistent?: boolean
  onDisconnect?: (reason: string) => void
}

export type ClientContext = {
  client: KernelClient
  config: ResolvedConfig
  avatarId?: AvatarId
  spaceId?: SpaceId
}

export async function withKernelClient<T>(
  options: WithClientOptions,
  fn: (ctx: ClientContext) => Promise<T>,
): Promise<T> {
  const config = await resolveConfig(options.profileName)
  const clientConfig: KernelClientConfig = {
    kernelWsUrl: config.kernelWsUrl,
    accessToken: config.accessToken,
    persistent: options.persistent,
    onDisconnect: options.onDisconnect,
  }
  const client = new KernelClient(clientConfig)
  await client.connect()
  try {
    let avatarId: AvatarId | undefined
    let spaceId: SpaceId | undefined
    if (options.requireAvatar) {
      const sessionInfo = client.getSessionInfo()
      if (!sessionInfo) throw new Error('Failed to get session info from kernel')
      spaceId = config.activeSpaceId
      if (!spaceId) throw new Error('No space selected. Run: astrale space select <id>')
      const mapping = sessionInfo.avatarsAndSpaces.find((m) => m.spaceId === spaceId)
      if (!mapping) throw new Error(`Space ${spaceId} not found for this user`)
      avatarId = mapping.avatarId as AvatarId
      client.setAvatarId(avatarId)
    }
    return await fn({ client, config, avatarId, spaceId })
  } finally {
    if (!options.persistent) client.disconnect()
  }
}
