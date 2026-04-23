import { fatalNotImplemented } from '../lib/log'

/** `astrale dev [up|down|status|logs]` — stubbed v1 (§4.5). */
export async function devCommand(subcommand?: string): Promise<void> {
  fatalNotImplemented(
    `astrale dev ${subcommand ?? 'up'}`,
    "Use `astrale start` + the domain's own dev script (e.g. `pnpm dev`) until the macro ships.",
  )
}
