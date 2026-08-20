/** Process-wide machine mode from argv (`--json` / `--raw` / `--ci`). */

let argvMachine = false

export function configureInvocation(argv: readonly string[]): void {
  argvMachine = argv.some((token) => token === '--json' || token === '--raw' || token === '--ci')
}

export function invocationWantsMachine(): boolean {
  return argvMachine
}
