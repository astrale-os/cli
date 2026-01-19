import { DatastoreClient } from '@astrale-os/datastore-client'
import type { BootstrapDataGrant, EditModuleResultWithBackend } from '@astrale-os/kernel-api'
import type {
  AppBuildResult,
  AppCreateResult,
  AppDevelopResult,
  AppDiscoverResult,
  DevelopmentConfig,
  EndpointGrant,
} from '@astrale-os/kernel-api/system'
import type { KernelWSClient } from '@astrale-os/kernel-client-ws'
import type { AvatarId, ModuleId, SpaceId } from '@astrale-os/kernel-core'
import { SYSTEM_APPS } from '@astrale-os/kernel-core'
import type { SerializedApp, SerializedEndpoints } from '@astrale-os/sdk-app'

const APPMGR_APP_ID = SYSTEM_APPS.APPS.id
const MAX_RECONNECT_RETRIES = 10

export interface KernelClientConfig {
  kernelWsUrl: string
  datastoreUrl?: string
  avatarId: AvatarId
  accessToken: string
  persistent?: boolean
  onDisconnect?: (reason: string) => void
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

  constructor(config: KernelClientConfig) {
    this.config = config
    this.datastore = new DatastoreClient()
  }

  private get ctx() {
    return { avatarId: this.config.avatarId, appId: APPMGR_APP_ID }
  }

  private get ws(): KernelWSClient {
    if (!this.wsClient) throw new Error('KernelClient not connected. Call connect() first.')
    return this.wsClient
  }

  async connect(): Promise<void> {
    const { KernelWSClient } = await import('@astrale-os/kernel-client-ws')
    const client = new KernelWSClient({
      wsUrl: this.config.kernelWsUrl,
      token: this.config.accessToken,
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
    this.wsClient?.disconnect()
    this.wsClient = null
  }

  async createApp(
    parentId: ModuleId | AvatarId | SpaceId,
    config?: Partial<DevelopmentConfig>,
    publicKeyJwk?: JsonWebKey,
  ): Promise<AppCreateResult> {
    return this.ws.callSystem(
      'appmgr.create',
      { parentId, publicKeyJwk: publicKeyJwk ? JSON.stringify(publicKeyJwk) : undefined, config },
      this.ctx,
    ) as Promise<AppCreateResult>
  }

  async develop(schema: SerializedApp, config: DevelopmentConfig): Promise<AppDevelopResult> {
    return this.ws.callSystem(
      'appmgr.develop',
      { schema, config },
      this.ctx,
    ) as Promise<AppDevelopResult>
  }

  async build(parentId: ModuleId, schema: SerializedApp): Promise<AppBuildResult> {
    return this.ws.callSystem(
      'appmgr.build',
      { parentId, schema },
      this.ctx,
    ) as Promise<AppBuildResult>
  }

  async resolveApplication(slug: string): Promise<{ appId: string; slug: string }> {
    return this.ws.callSystem('appmgr.resolve', { slug }, this.ctx) as Promise<{
      appId: string
      slug: string
    }>
  }

  async discoverApplication(appId: string, version?: string): Promise<AppDiscoverResult> {
    return this.ws.callSystem(
      'appmgr.discover',
      { appId, version },
      this.ctx,
    ) as Promise<AppDiscoverResult>
  }

  async editModule(
    moduleId: ModuleId,
    options: { contentType?: string; backend?: string } = {},
  ): Promise<EditModuleResultWithBackend> {
    return this.ws.call(
      'module.edit',
      {
        moduleId,
        metadata: options.contentType
          ? { contentType: options.contentType, name: 'worker.js' }
          : undefined,
        backend: options.backend ?? 'kv',
      },
      this.ctx,
    ) as Promise<EditModuleResultWithBackend>
  }

  async uploadWorkerBundle(
    workerBundleId: ModuleId,
    code: string | Uint8Array,
  ): Promise<{ bytes: number }> {
    const editResult = await this.editModule(workerBundleId, {
      contentType: 'application/javascript',
      backend: 'kv',
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
