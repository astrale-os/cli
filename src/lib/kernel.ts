/**
 * Kernel Client for SDK CLI
 *
 * Unified client for all kernel operations (init, build, dev).
 */

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
import type { AvatarId, ModuleId, SpaceId } from '@astrale-os/kernel-core'
import { SYSTEM_APPS } from '@astrale-os/kernel-core'
import type { SerializedApp, SerializedEndpoints } from '@astrale-os/sdk-app'

const APPMGR_APP_ID = SYSTEM_APPS.APPS.id

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface KernelClientConfig {
  kernelUrl: string
  datastoreUrl?: string
  avatarId: AvatarId
  token: string
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

// ─────────────────────────────────────────────────────────────────────────────
// Kernel Client
// ─────────────────────────────────────────────────────────────────────────────

export class KernelClient {
  private wsClient: any = null
  private config: KernelClientConfig
  private datastore: DatastoreClient

  constructor(config: KernelClientConfig) {
    this.config = config
    this.datastore = new DatastoreClient()
  }

  private get ctx() {
    return { avatarId: this.config.avatarId, appId: APPMGR_APP_ID }
  }

  async connect(): Promise<void> {
    const { KernelWSClient } = await import('@astrale-os/kernel-client-ws')
    const client = new KernelWSClient({
      wsUrl: this.config.kernelUrl,
      token: this.config.token,
      autoConnect: true,
      reconnect: this.config.persistent ?? false,
      maxRetries: this.config.persistent ? 10 : undefined,
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

  private ensureConnected(): void {
    if (!this.wsClient) {
      throw new Error('KernelClient not connected. Call connect() first.')
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Appmgr Operations
  // ─────────────────────────────────────────────────────────────────────────

  async createApp(
    parentId: ModuleId | AvatarId | SpaceId,
    config?: Partial<DevelopmentConfig>,
    publicKeyJwk?: JsonWebKey,
  ): Promise<AppCreateResult> {
    this.ensureConnected()
    return this.wsClient!.callSystem(
      'appmgr.create',
      {
        parentId,
        publicKeyJwk: publicKeyJwk ? JSON.stringify(publicKeyJwk) : undefined,
        config,
      },
      this.ctx,
    )
  }

  async develop(schema: SerializedApp, config: DevelopmentConfig): Promise<AppDevelopResult> {
    this.ensureConnected()
    return this.wsClient!.callSystem('appmgr.develop', { schema, config }, this.ctx)
  }

  async build(parentId: ModuleId, schema: SerializedApp): Promise<AppBuildResult> {
    this.ensureConnected()
    return this.wsClient!.callSystem('appmgr.build', { parentId, schema }, this.ctx)
  }

  async resolveApplication(slug: string): Promise<{ appId: string; slug: string }> {
    this.ensureConnected()
    return this.wsClient!.callSystem('appmgr.resolve', { slug }, this.ctx)
  }

  async discoverApplication(appId: string, version?: string): Promise<AppDiscoverResult> {
    this.ensureConnected()
    return this.wsClient!.callSystem('appmgr.discover', { appId, version }, this.ctx)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Module Operations
  // ─────────────────────────────────────────────────────────────────────────

  async editModule(
    moduleId: ModuleId,
    options: { contentType?: string; backend?: string } = {},
  ): Promise<EditModuleResultWithBackend> {
    this.ensureConnected()
    return this.wsClient!.call(
      'module.edit',
      {
        moduleId,
        metadata: options.contentType
          ? { contentType: options.contentType, name: 'worker.js' }
          : undefined,
        backend: options.backend ?? 'kv',
      },
      this.ctx,
    )
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bundle & Data Upload
  // ─────────────────────────────────────────────────────────────────────────

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
    let totalBytes = 0
    let count = 0

    for (const { path, grant } of grants) {
      const data = dataMap.get(path)
      if (data === undefined) {
        console.warn(`[astrale] Bootstrap data not found for path: ${path}`)
        continue
      }

      const storageUri = grant.objects[0]?.uri
      if (!storageUri) continue

      const writeResult = await this.datastore.writeObject({
        grant,
        storageUri,
        data: JSON.stringify(data),
      })
      totalBytes += writeResult.bytes
      count++
    }

    return { count, bytes: totalBytes }
  }

  async uploadEndpointDocs(
    grants: EndpointGrant[],
    endpoints: SerializedEndpoints,
  ): Promise<{ count: number; bytes: number }> {
    let totalBytes = 0
    let count = 0

    for (const { name, type, grant } of grants) {
      const endpointContainer = type === 'worker' ? endpoints.worker : endpoints.backend
      const endpoint = endpointContainer[name]

      if (!endpoint?.documentation) continue

      const storageUri = grant.objects[0]?.uri
      if (!storageUri) continue

      const writeResult = await this.datastore.writeObject({
        grant,
        storageUri,
        data: endpoint.documentation,
      })
      totalBytes += writeResult.bytes
      count++
    }

    return { count, bytes: totalBytes }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export async function createKernelClient(config: KernelClientConfig): Promise<KernelClient> {
  const client = new KernelClient(config)
  await client.connect()
  return client
}
