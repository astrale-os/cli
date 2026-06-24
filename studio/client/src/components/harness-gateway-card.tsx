import type { HarnessGatewayAuth } from '@shared/types'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, HelpCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { api, qk } from '@/lib/api'
import { useHarnessGateway } from '@/lib/hooks'
import { cn } from '@/lib/utils'

/**
 * HarnessGatewayCard — point the local Claude Code harness at a custom
 * Anthropic-compatible model gateway (e.g. an Astrale `ai-gateway` model node)
 * for THIS domain. The URL + token reach the spawned `claude` child only — never
 * your shell or a `claude` you run yourself outside the studio.
 *
 * Auth has three modes (HarnessGatewayAuth) so the same config works locally and,
 * later, when the studio runs embedded in the Astrale GUI:
 *   - Auto-mint  — the studio mints a fresh delegation token per run (no secret on disk).
 *   - Static token — a bearer you paste (non-Astrale gateways).
 *   - Host-managed — the embedding Astrale app supplies the token via the shell.
 *
 * Scope is per-domain by default; "Apply to all domains" promotes it to a
 * studio-wide default. Self-contained (own fetch + save), mirroring EnvEditor.
 */
type AuthMode = HarnessGatewayAuth['mode']

/** Embedded in an iframe (i.e. inside the Astrale GUI) → host-managed auth fits. */
const EMBEDDED = typeof window !== 'undefined' && window.self !== window.top

function Hint({ text }: { text: string }) {
  return (
    <HoverCard openDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label="What's this?"
          className="text-muted-foreground/40 transition-colors hover:text-foreground"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-auto max-w-xs text-[13px] leading-relaxed text-muted-foreground">
        {text}
      </HoverCardContent>
    </HoverCard>
  )
}

const MODE_LABEL: Record<AuthMode, string> = {
  mint: 'Auto-mint',
  token: 'Static token',
  host: 'Host-managed',
}
const MODES: AuthMode[] = ['mint', 'token', 'host']

export function HarnessGatewayCard({ domainId }: { domainId?: string }) {
  const { data: gw } = useHarnessGateway(domainId)
  const qc = useQueryClient()

  const [enabled, setEnabled] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [mode, setMode] = useState<AuthMode>(EMBEDDED ? 'host' : 'mint')
  const [instance, setInstance] = useState('')
  const [token, setToken] = useState('')
  const [applyToAll, setApplyToAll] = useState(false)
  const [reveal, setReveal] = useState(false)

  // Seed the form from the effective config (local override, else global default).
  useEffect(() => {
    if (!gw) return
    const eff = gw.local ?? gw.global ?? null
    setEnabled(eff?.enabled ?? false)
    setBaseUrl(eff?.baseUrl ?? '')
    setModel(eff?.model ?? '')
    setMode(eff?.auth.mode ?? (EMBEDDED ? 'host' : 'mint'))
    setInstance(eff?.auth.mode === 'mint' ? (eff.auth.instance ?? '') : '')
    setToken(eff?.auth.mode === 'token' ? eff.auth.token : '')
    setApplyToAll(gw.local == null && gw.global != null)
  }, [gw])

  const buildAuth = (): HarnessGatewayAuth => {
    if (mode === 'token') return { mode: 'token', token: token.trim() }
    if (mode === 'host') return { mode: 'host' }
    return { mode: 'mint', ...(instance.trim() ? { instance: instance.trim() } : {}) }
  }

  const save = useMutation({
    mutationFn: () =>
      api.setHarnessGateway(domainId!, applyToAll ? 'global' : 'domain', {
        enabled,
        baseUrl: baseUrl.trim(),
        model: model.trim() || undefined,
        auth: buildAuth(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.harnessGateway(domainId!) })
      qc.invalidateQueries({ queryKey: qk.loadout(domainId!) }) // model readout reflects the gateway
      toast.success(applyToAll ? 'Saved for all domains' : 'Saved for this domain')
    },
    onError: (e) => toast.error(String(e)),
  })

  const reset = useMutation({
    mutationFn: () => api.clearHarnessGateway(domainId!, 'domain'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.harnessGateway(domainId!) })
      qc.invalidateQueries({ queryKey: qk.loadout(domainId!) })
      toast.success('Override removed — inheriting the default')
    },
    onError: (e) => toast.error(String(e)),
  })

  const source = gw?.source ?? 'none'
  const sourceLabel =
    source === 'domain'
      ? 'active for this domain'
      : source === 'global'
        ? 'inherited from the studio-wide default'
        : 'off — the harness uses its own Claude Code auth'

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Model gateway
        </span>
        <Hint text="Route the local Claude Code harness through a custom Anthropic-compatible endpoint (e.g. an Astrale ai-gateway model node) instead of its built-in auth. The URL + token are set as ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN on the spawned `claude` child ONLY — never your shell or a `claude` you run outside the studio." />
        <span className="ml-auto text-[10px] text-muted-foreground/60">{sourceLabel}</span>
      </div>

      <div className="space-y-2.5 rounded-lg border bg-card/40 px-3 py-2.5">
        {/* Enabled toggle */}
        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          <span>Use a custom model gateway</span>
        </label>

        {enabled && (
          <div className="space-y-2.5 border-t pt-2.5">
            {/* Base URL */}
            <div className="space-y-1">
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                Base URL
                <Hint text="ANTHROPIC_BASE_URL. Claude Code POSTs to `${baseUrl}/v1/messages`. For an Astrale model node: https://<gateway-host>/v1/models/<modelNodeId>. The token audience is derived from this URL's origin." />
              </span>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://ai-gateway.astrale.ai/v1/models/<modelNodeId>"
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-md border bg-background px-2 py-1 font-mono text-[12px] outline-none placeholder:text-muted-foreground/40 focus:border-primary"
              />
            </div>

            {/* Model label */}
            <div className="space-y-1">
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                Model label
                <Hint text="ANTHROPIC_MODEL — shown in the loadout and sent as the request `model`. Cosmetic: an Astrale gateway pins the real model by URL, so this is just a name (e.g. glm-5.2)." />
              </span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="glm-5.2 (optional)"
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-md border bg-background px-2 py-1 font-mono text-[12px] outline-none placeholder:text-muted-foreground/40 focus:border-primary"
              />
            </div>

            {/* Auth mode */}
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                Authentication
                <Hint text="How the harness gets its bearer token. Auto-mint: the studio mints a short-lived delegation token per run via `astrale token` (no secret stored) — best for Astrale gateways. Static token: a bearer you paste. Host-managed: the embedding Astrale app supplies it via the shell (used when the studio runs inside the Astrale GUI)." />
              </span>
              <div
                className="grid grid-cols-3 gap-1 rounded-md bg-muted/45 p-1"
                role="radiogroup"
                aria-label="Auth mode"
              >
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={cn(
                      'rounded px-1.5 py-1 text-center text-[11px] font-medium transition-colors',
                      mode === m
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                    )}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>

              {mode === 'mint' && (
                <div className="space-y-1 pt-0.5">
                  <input
                    value={instance}
                    onChange={(e) => setInstance(e.target.value)}
                    placeholder="instance to mint on (blank = active instance)"
                    spellCheck={false}
                    autoComplete="off"
                    className="w-full rounded-md border bg-background px-2 py-1 font-mono text-[12px] outline-none placeholder:text-muted-foreground/40 focus:border-primary"
                  />
                  <p className="text-[10px] leading-relaxed text-muted-foreground/60">
                    A fresh delegation token is minted per run (no secret stored). You must be
                    signed in to the instance and have USE on the model node.
                  </p>
                </div>
              )}

              {mode === 'token' && (
                <div className="space-y-1 pt-0.5">
                  <div className="flex items-center gap-1">
                    <input
                      type={reveal ? 'text' : 'password'}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="bearer token (e.g. astrale token --audience <gateway-origin>)"
                      spellCheck={false}
                      autoComplete="off"
                      className="w-full min-w-0 rounded-md border bg-background px-2 py-1 font-mono text-[12px] outline-none placeholder:text-muted-foreground/40 focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setReveal((v) => !v)}
                      title={reveal ? 'Hide' : 'Reveal'}
                      className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
                    >
                      {reveal ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] leading-relaxed text-muted-foreground/60">
                    Stored locally in .domain-studio. It will stop working when the token expires.
                  </p>
                </div>
              )}

              {mode === 'host' && (
                <p className="pt-0.5 text-[10px] leading-relaxed text-muted-foreground/60">
                  {EMBEDDED
                    ? 'The embedding Astrale app supplies (and refreshes) the token via the shell.'
                    : 'For when the studio runs embedded in the Astrale GUI — the host then supplies the token via the shell. No effect standalone.'}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Apply to all domains */}
        <label className="flex cursor-pointer items-center gap-2 border-t pt-2.5 text-[12px]">
          <input
            type="checkbox"
            checked={applyToAll}
            onChange={(e) => setApplyToAll(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          <span className="flex items-center gap-1.5">
            Apply to all domains
            <Hint text="Save as the studio-wide default for every domain (and clear this domain's own override so it inherits it). Off ⇒ this setting applies to THIS domain only. Either way it never leaks outside the studio." />
          </span>
        </label>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            disabled={!domainId || save.isPending}
            onClick={() => save.mutate()}
            className="rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {save.isPending
              ? 'Saving…'
              : applyToAll
                ? 'Save for all domains'
                : 'Save for this domain'}
          </button>
          {gw?.local != null && (
            <button
              type="button"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
              className="rounded-md px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              title="Remove this domain's override and inherit the studio-wide default (or default auth)"
            >
              Reset to default
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
