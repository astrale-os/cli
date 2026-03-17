export interface AstraleConfig {
  /** Graph name in the database. Default: directory name */
  graphName?: string
  /** FalkorDB host. Default: 'localhost' */
  host?: string
  /** FalkorDB port. Default: 6379 */
  port?: number

  /** Path to .gsl schema file. Default: './schema/main.gsl' */
  schema?: string
  /** Directory for generated output. Default: './schema/generated' */
  outputDir?: string

  /** Path to distribution entry file (default export = DistributionConfig). Default: './src/distribution.ts' */
  entry?: string

  /** WebSocket server port. Default: 3001 */
  wsPort?: number
  /** Issuer for dev credentials. Default: 'https://local.kernel' */
  issuer?: string
}

export function defineConfig(config: AstraleConfig): AstraleConfig {
  return config
}
