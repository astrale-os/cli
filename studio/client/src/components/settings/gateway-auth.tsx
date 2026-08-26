import type { HarnessGatewayAuth } from '@shared/types'

import { Eye, EyeOff } from 'lucide-react'

import { cn } from '@/lib/utils'

import { SettingsHint } from './hint'

export type GatewayAuthMode = HarnessGatewayAuth['mode']

export const embeddedStudio = typeof window !== 'undefined' && window.self !== window.top

const LABELS: Record<GatewayAuthMode, string> = {
  mint: 'Auto-mint',
  token: 'Static token',
  host: 'Host-managed',
}

const MODES: GatewayAuthMode[] = ['mint', 'token', 'host']

/** Authentication-specific fields for one harness gateway. */
export function GatewayAuthFields({
  mode,
  setMode,
  instance,
  setInstance,
  token,
  setToken,
  reveal,
  setReveal,
}: {
  mode: GatewayAuthMode
  setMode: (mode: GatewayAuthMode) => void
  instance: string
  setInstance: (instance: string) => void
  token: string
  setToken: (token: string) => void
  reveal: boolean
  setReveal: (reveal: boolean) => void
}) {
  return (
    <div className="space-y-1.5">
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        Authentication
        <SettingsHint text="How the harness gets its bearer token. Auto-mint: the studio mints a short-lived delegation token per run via `astrale token` (no secret stored) — best for Astrale gateways. Static token: a bearer you paste. Host-managed: the embedding Astrale app supplies it via the shell (used when the studio runs inside the Astrale GUI)." />
      </span>
      <div
        className="grid grid-cols-3 gap-1 rounded-md bg-muted/45 p-1"
        role="radiogroup"
        aria-label="Auth mode"
      >
        {MODES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={mode === candidate}
            onClick={() => setMode(candidate)}
            className={cn(
              'rounded px-1.5 py-1 text-center text-[11px] font-medium transition-colors',
              mode === candidate
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {LABELS[candidate]}
          </button>
        ))}
      </div>

      {mode === 'mint' && (
        <div className="space-y-1 pt-0.5">
          <input
            value={instance}
            onChange={(event) => setInstance(event.target.value)}
            placeholder="instance to mint on (blank = active instance)"
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded-md border bg-card px-2 py-1 font-mono text-[12px] outline-none placeholder:text-muted-foreground focus:border-primary"
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            A fresh delegation token is minted per run (no secret stored). You must be signed in to
            the instance and have USE on the model node.
          </p>
        </div>
      )}

      {mode === 'token' && (
        <div className="space-y-1 pt-0.5">
          <div className="flex items-center gap-1">
            <input
              type={reveal ? 'text' : 'password'}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="bearer token (e.g. astrale token --audience <gateway-origin>)"
              spellCheck={false}
              autoComplete="off"
              className="w-full min-w-0 rounded-md border bg-card px-2 py-1 font-mono text-[12px] outline-none placeholder:text-muted-foreground focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setReveal(!reveal)}
              title={reveal ? 'Hide' : 'Reveal'}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Stored locally in .domain-studio. It will stop working when the token expires.
          </p>
        </div>
      )}

      {mode === 'host' && (
        <p className="pt-0.5 text-[10px] leading-relaxed text-muted-foreground">
          {embeddedStudio
            ? 'The embedding Astrale app supplies (and refreshes) the token via the shell.'
            : 'For when the studio runs embedded in the Astrale GUI — the host then supplies the token via the shell. No effect standalone.'}
        </p>
      )}
    </div>
  )
}
