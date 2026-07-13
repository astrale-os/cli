/**
 * Isolated adapter-config probe. Importing astrale.config.ts executes the domain's module graph,
 * so Studio runs this in a short-lived Bun process rather than its long-lived server.
 */
export {}

const OUTPUT_PREFIX = '__ASTRALE_STUDIO_CLIENT_PACKAGE__'
const configPath = process.argv[2]
const projectDir = process.argv[3]
const env = process.argv[4] ?? 'dev'

async function main(): Promise<void> {
  if (!configPath || !projectDir) throw new Error('missing config path or project directory')
  const mod = (await import(configPath)) as { default?: unknown }
  const config = mod.default as
    | {
        adapter?: {
          name?: unknown
          params?: (env: string) => unknown
          clientPackage?: (params: unknown, ctx: { projectDir: string; env: string }) => unknown
        }
      }
    | undefined
  const adapter = config?.adapter
  if (!adapter || typeof adapter.params !== 'function') {
    throw new Error('default export has no deployment adapter')
  }
  const adapterName = typeof adapter.name === 'string' ? adapter.name : 'unknown'
  if (typeof adapter.clientPackage !== 'function') {
    writeResult({ ok: true, supported: false, adapterName })
    return
  }
  const params = adapter.params(env)
  const client = adapter.clientPackage(params, { projectDir, env }) as { dir?: unknown } | undefined
  if (client !== undefined && typeof client?.dir !== 'string') {
    throw new Error(`adapter "${adapterName}" returned an invalid client package`)
  }
  writeResult({
    ok: true,
    supported: true,
    adapterName,
    dir: client?.dir ?? null,
  })
}

main().catch((error: unknown) => {
  writeResult({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  })
  process.exit(0)
})

function writeResult(result: unknown): void {
  process.stdout.write(`${OUTPUT_PREFIX}${JSON.stringify(result)}\n`)
}
