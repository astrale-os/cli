import { DatastoreClient } from '@astrale-os/datastore-client'
import type { BootstrapDataGrant, EditModuleResultWithStorage } from '@astrale-os/kernel-api'
import type { SpaceCreateResult } from '@astrale-os/kernel-api/namespaces'
import type {
  AppBuildResult,
  AppCreateResult,
  AppDevelopResult,
  AppDiscoverResult,
  DevelopmentConfig,
  EndpointGrant,
} from '@astrale-os/kernel-api/namespaces'
import type { CallIdentity, KernelWSClient } from '@astrale-os/kernel-client-ws'
import type { AvatarId, IdentityId, ModuleId, SpaceId } from '@astrale-os/kernel-core'
import { selfGrant } from '@astrale-os/kernel-core'
import type { SerializedApp, SerializedEndpoints } from '@astrale-os/sdk-app'
import { TokenRefreshManager } from './token-refresh-manager'

const MAX_RECONNECT_RETRIES = 10

export interface KernelClientConfig {
  kernelWsUrl: string
  datastoreUrl: string
  avatarId?: AvatarId
  accessToken: string
  persistent?: boolean
  onDisconnect?: (reason: string) => void
  profileName?: string
  onTokenRefresh?: (newToken: string) => void
  onTokenRefreshError?: (error: Error) => void
}

export type {
  AppBuildResult,
  AppCreateResult,
  AppDevelopResult,
  AppDiscoverResult,
  BootstrapDataGrant,
  DevelopmentConfig,
  EndpointGrant,
}

export class KernelClient {
  private wsClient: KernelWSClient | null = null
  private config: KernelClientConfig
  private datastore: DatastoreClient
  private _avatarId: AvatarId | null = null
  private tokenManager: TokenRefreshManager | null = null

  constructor(config: KernelClientConfig) {
    this.config = config
    this._avatarId = config.avatarId ?? null
    this.datastore = new DatastoreClient({ baseUrl: config.datastoreUrl })

    if (config.profileName && config.persistent) {
      this.tokenManager = new TokenRefreshManager({
        profileName: config.profileName,
        onRefresh: (token) => {
          console.log('  \u21bb Token refreshed')
          config.onTokenRefresh?.(token)
        },
        onError: (error) => {
          console.error('  \u26a0 Token refresh failed:', error.message)
          config.onTokenRefreshError?.(error)
        },
      })
    }
  }

  private get identity(): CallIdentity | undefined {
    if (!this._avatarId) return undefined
    const principal = this._avatarId as string as IdentityId
    return { principal, grant: selfGrant(principal) }
  }

  private get ws(): KernelWSClient {
    if (!this.wsClient) throw new Error('KernelClient not connected. Call connect() first.')
    return this.wsClient
  }

  get avatarId(): AvatarId | null {
    return this._avatarId
  }

  setAvatarId(avatarId: AvatarId): void {
    this._avatarId = avatarId
  }

  async connect(): Promise<void> {
    const { KernelWSClient } = await import('@astrale-os/kernel-client-ws')

    let getToken: () => string | Promise<string>

    if (this.tokenManager) {
      await this.tokenManager.start()
      getToken = () => this.tokenManager!.getToken()
    } else {
      const token = this.config.accessToken
      getToken = () => token
    }

    const client = new KernelWSClient({
      wsUrl: this.config.kernelWsUrl,
      getToken,
      autoConnect: true,
      reconnect: this.config.persistent ?? false,
      maxRetries: this.config.persistent ? MAX_RECONNECT_RETRIES : undefined,
    })
    if (this.config.persistent && this.config.onDisconnect) {
      client.on('disconnected', this.config.onDisconnect)
    }
    await client.connect()
    this.wsClient = client
  }

  disconnect(): void {
    this.tokenManager?.stop()
    this.wsClient?.disconnect()
    this.wsClient = null
  }

  async createSpace(name: string): Promise<SpaceCreateResult> {
    return this.ws.call('spaces.create', { name }) as Promise<SpaceCreateResult>
  }

  async listSpaces(): Promise<{ spaces: Array<{ spaceId: SpaceId; name: string }> }> {
    return this.ws.call('spaces.list', {}) as Promise<{
      spaces: Array<{ spaceId: SpaceId; name: string }>
    }>
  }

  async createAvatar(
    spaceId: SpaceId,
    username: string,
    isFirstAvatar: boolean,
  ): Promise<{ avatarId: AvatarId; spaceId: SpaceId }> {
    return this.ws.call(
      'avatars.create',
      { spaceId, username, isFirstAvatar },
    ) as Promise<{ avatarId: AvatarId; spaceId: SpaceId }>
  }

  async createApp(
    parentId: ModuleId | AvatarId | SpaceId,

    config?: Partial<DevelopmentConfig>,
    publicKeyJwk?: JsonWebKey,
  ): Promise<AppCreateResult> {
    const params = {
      parentId,
      publicKeyJwk: publicKeyJwk ? JSON.stringify(publicKeyJwk) : undefined,
      config,
    }
    return this.ws.call('appmgr.create', params, this.identity) as Promise<AppCreateResult>
  }

  async develop(schema: SerializedApp, config: DevelopmentConfig): Promise<AppDevelopResult> {
    return this.ws.call(
      'appmgr.develop',
      { schema, config },
      this.identity,
    ) as Promise<AppDevelopResult>
  }

  async build(parentId: ModuleId, schema: SerializedApp): Promise<AppBuildResult> {
    return this.ws.call(
      'appmgr.build',
      { parentId, schema },
      this.identity,
    ) as Promise<AppBuildResult>
  }

  async resolveApplication(slug: string): Promise<{ appId: string; slug: string }> {
    return this.ws.call('appmgr.resolve', { slug }, this.identity) as Promise<{
      appId: string
      slug: string
    }>
  }

  async discoverApplication(appId: string, version?: string): Promise<AppDiscoverResult> {
    return this.ws.call(
      'appmgr.discover',
      { appId, version },
      this.identity,
    ) as Promise<AppDiscoverResult>
  }

  async editModule(
    moduleId: ModuleId,
    options: { contentType?: string; storage?: boolean } = {},
  ): Promise<EditModuleResultWithStorage> {
    return this.ws.call(
      'module.edit',
      {
        moduleId,
        metadata: options.contentType
          ? { contentType: options.contentType, name: 'worker.js' }
          : undefined,
        storage: options.storage,
      },
      this.identity,
    ) as Promise<EditModuleResultWithStorage> // narrowed from EditModuleResult
  }

  async uploadWorkerBundle(
    workerBundleId: ModuleId,
    code: string | Uint8Array,
  ): Promise<{ bytes: number }> {
    const editResult = await this.editModule(workerBundleId, {
      contentType: 'application/javascript',
      storage: true,
    })
    const writeResult = await this.datastore.writeObject({
      grant: editResult.datastoreGrant,
      storageUri: editResult.storageUri,
      data: code,
    })
    return { bytes: writeResult.bytes }
  }

  async uploadBootstrapData(
    grants: BootstrapDataGrant[],
    dataMap: Map<string, unknown>,
  ): Promise<{ count: number; bytes: number }> {
    const uploads = grants.flatMap(({ path, grant }) => {
      const data = dataMap.get(path)
      if (data === undefined) {
        console.warn(`[astrale] Bootstrap data not found for path: ${path}`)
        return []
      }
      const storageUri = grant.objects[0]?.uri
      if (!storageUri) return []
      return [this.datastore.writeObject({ grant, storageUri, data: JSON.stringify(data) })]
    })
    const results = await Promise.all(uploads)
    return { count: results.length, bytes: results.reduce((sum, r) => sum + r.bytes, 0) }
  }

  async uploadEndpointDocs(
    grants: EndpointGrant[],
    endpoints: SerializedEndpoints,
  ): Promise<{ count: number; bytes: number }> {
    const uploads = grants.flatMap(({ name, type, grant }) => {
      const endpointContainer = type === 'worker' ? endpoints.worker : endpoints.backend
      const endpoint = endpointContainer[name]
      if (!endpoint?.documentation) return []
      const storageUri = grant.objects[0]?.uri
      if (!storageUri) return []
      return [this.datastore.writeObject({ grant, storageUri, data: endpoint.documentation })]
    })
    const results = await Promise.all(uploads)
    return { count: results.length, bytes: results.reduce((sum, r) => sum + r.bytes, 0) }
  }
}

export async function createKernelClient(config: KernelClientConfig): Promise<KernelClient> {
  const client = new KernelClient(config)
  await client.connect()
  return client
}
