/**
 * TunnelAdapter port (DESIGN §11, §12). Concrete adapters plug into this
 * contract: cloudflared (v1), ngrok / tailscale (roadmap).
 *
 * The port owns the NEUTRAL routing model (`IngressRule`, `TunnelRunSpec`).
 * Astrale's contract is deliberately narrow: http(s) `hostname → service`
 * routing only. Anything an adapter cannot express in these terms it must
 * reject loudly (see `importExisting`), never translate with loss.
 */

export type TunnelDescriptor = {
  /** Provider-specific tunnel id (UUID for cloudflared named tunnels). */
  id: string
  /** Human-readable name used by the CLI as primary identifier. */
  name: string
  /** Public hostname that resolves to the tunnel. */
  hostname: string
  /** Adapter that owns this tunnel. */
  adapter: string
}

export type TunnelStatus = 'running' | 'stopped' | 'unknown'

/**
 * One ingress rule: a public hostname forwarded to a local service URL.
 * Wildcards (`*.foo.bar`) are valid hostnames. `service` is an http(s) URL
 * (astrale's contract). `path` is an optional cloudflared-style path match.
 */
export type IngressRule = {
  hostname: string
  service: string
  path?: string
}

/**
 * Everything an adapter needs to start a tunnel. Passed in by the command
 * layer (read from the registry) so the adapter never reaches back into
 * `tunnels.json` itself.
 */
export type TunnelRunSpec = {
  id: string
  hostname: string
  ingress: IngressRule[]
}

/** Result of importing an externally-created tunnel into the registry. */
export type ImportResult = {
  descriptor: TunnelDescriptor
  /** http(s) ingress rules extracted from the adapter's native config. */
  ingress: IngressRule[]
  /** First concrete (non-wildcard) hostname, for the registry's primary `hostname`. */
  suggestedHostname?: string
}

export interface TunnelAdapter {
  readonly name: string

  /**
   * Create a new tunnel. With `routeDns: true` the adapter also registers
   * DNS routing (requires a zone it owns); otherwise DNS is the user's job.
   */
  create(opts: { name: string; hostname: string; routeDns?: boolean }): Promise<TunnelDescriptor>

  delete(id: string): Promise<void>

  list(): Promise<TunnelDescriptor[]>

  /** Start the tunnel process in the background from the neutral spec. Returns the PID. */
  start(spec: TunnelRunSpec): Promise<{ pid: number }>

  stop(id: string): Promise<void>

  /** Resolve DNS for the tunnel hostname. Throws TunnelDnsUnresolvedError on failure. */
  dnsPreflight(hostname: string): Promise<void>

  status(id: string): Promise<TunnelStatus>

  /** Whether the underlying binary/service is reachable on this machine. */
  isAvailable(): Promise<boolean>

  /**
   * Import an existing (externally-created) tunnel from the adapter's native
   * config. MUST throw `TunnelUnsupportedConfigError` if the config contains
   * routes astrale cannot model (non-http(s) services, per-rule provider
   * options) rather than importing them partially.
   */
  importExisting(name: string): Promise<ImportResult>
}
