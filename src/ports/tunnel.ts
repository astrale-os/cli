/**
 * TunnelAdapter port (SPEC §11, §12). Concrete adapters plug into this
 * contract: cloudflared (v1), ngrok / tailscale (roadmap).
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

export interface TunnelAdapter {
  readonly name: string

  /** Create a new tunnel. DNS routing is the user's responsibility unless the adapter handles it. */
  create(opts: { name: string; hostname: string }): Promise<TunnelDescriptor>

  delete(id: string): Promise<void>

  list(): Promise<TunnelDescriptor[]>

  /** Start the tunnel process in the background. Returns the PID. */
  start(id: string): Promise<{ pid: number }>

  stop(id: string): Promise<void>

  /** Resolve DNS for the tunnel hostname. Throws TunnelDnsUnresolvedError on failure. */
  dnsPreflight(hostname: string): Promise<void>

  status(id: string): Promise<TunnelStatus>

  /** Whether the underlying binary/service is reachable on this machine. */
  isAvailable(): Promise<boolean>
}
