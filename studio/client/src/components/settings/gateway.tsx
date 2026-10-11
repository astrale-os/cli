import type { HarnessGatewayAuth, HarnessStatus } from '@shared/contracts/agent'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { api, qk } from '@/lib/api'
import { useHarnessGateway } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { SettingsHint } from './controls'

type GatewayAuthMode = HarnessGatewayAuth['mode']

const AUTH_MODES: { mode: GatewayAuthMode; label: string }[] = [
  { mode: 'mint', label: 'Auto-mint' },
  { mode: 'token', label: 'Static token' },
]

const FIELD =
  'w-full rounded-md border bg-card px-2 py-1 font-mono text-[12px] outline-none placeholder:text-muted-foreground focus:border-primary'

/** The reason an enabled gateway draft cannot be saved, or null when it can. */
export function validateGatewayDraft(
  enabled: boolean,
  baseUrl: string,
  mode: GatewayAuthMode,
  token: string,
): string | null {
  if (!enabled) return null
  const value = baseUrl.trim()
  if (!value) return 'Base URL is required while the custom gateway is enabled.'
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return 'Base URL must use http:// or https://.'
  } catch {
    return 'Base URL must be a valid URL.'
  }
  if (mode === 'token' && !token.trim()) return 'A static bearer token is required in token mode.'
  return null
}

function GatewayHeading({ status, help = false }: { status: string; help?: boolean }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 px-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Model gateway
      </span>
      {help && (
        <SettingsHint text="Route the local Claude Code harness through a custom Anthropic-compatible endpoint (e.g. an Astrale ai-gateway model node) instead of its built-in auth. The URL + token are set as ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN on the spawned `claude` child ONLY — never your shell or a `claude` you run outside the studio." />
      )}
      <span className="ml-auto text-[10px] text-muted-foreground">{status}</span>
    </div>
  )
}

function GatewayTextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="space-y-1">
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {label}
        <SettingsHint text={hint} />
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className={FIELD}
      />
    </div>
  )
}

/** Machine-wide Anthropic-compatible gateway configuration. */
export function HarnessGatewaySettings({ harness }: { harness?: HarnessStatus }) {
  const anthropic = harness?.capabilities.gateway === 'anthropic'
  const { data: gateway, isFetching: gatewayFetching } = useHarnessGateway(anthropic)
  const queryClient = useQueryClient()

  const [enabled, setEnabled] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [mode, setMode] = useState<GatewayAuthMode>('mint')
  const [instance, setInstance] = useState('')
  const [token, setToken] = useState('')
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    const config = gateway?.config
    setEnabled(config?.enabled ?? false)
    setBaseUrl(config?.baseUrl ?? '')
    setModel(config?.model ?? '')
    setMode(config?.auth.mode ?? 'mint')
    setInstance(config?.auth.mode === 'mint' ? (config.auth.instance ?? '') : '')
    setToken(config?.auth.mode === 'token' ? config.auth.token : '')
    setReveal(false)
  }, [gateway])

  const buildAuth = (): HarnessGatewayAuth => {
    if (mode === 'token') return { mode: 'token', token: token.trim() }
    return { mode: 'mint', ...(instance.trim() ? { instance: instance.trim() } : {}) }
  }
  const validationError = validateGatewayDraft(enabled, baseUrl, mode, token)

  const invalidateGateway = () => {
    queryClient.invalidateQueries({ queryKey: qk.harnessGateway })
    queryClient.invalidateQueries({ queryKey: qk.loadout() })
  }

  const save = useMutation({
    mutationFn: api.setHarnessGateway,
    onSuccess: () => {
      invalidateGateway()
      toast.success('Machine gateway saved')
    },
    onError: (error) => toast.error(String(error)),
  })

  const reset = useMutation({
    mutationFn: api.clearHarnessGateway,
    onSuccess: () => {
      invalidateGateway()
      toast.success('Gateway configuration cleared')
    },
    onError: (error) => toast.error(String(error)),
  })

  if (harness && !anthropic)
    return (
      <div>
        <GatewayHeading status="not applicable" />
        <div className="rounded-lg border bg-card px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
          {harness.id === 'codex'
            ? 'Codex uses its own local login. The Astrale gateway currently exposes Chat Completions and Anthropic Messages, while Codex custom providers require the Responses API.'
            : `${harness.label} does not expose a Studio model-gateway adapter.`}
        </div>
      </div>
    )

  return (
    <div>
      <GatewayHeading
        status={
          gateway?.source === 'machine'
            ? 'active on this machine'
            : 'off — the harness uses its own auth'
        }
        help
      />
      <div className="space-y-2.5 rounded-lg border bg-card px-3 py-2.5">
        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          <span>Use a custom model gateway</span>
        </label>

        {enabled && (
          <div className="space-y-2.5 border-t pt-2.5">
            <GatewayTextField
              label="Base URL"
              hint="ANTHROPIC_BASE_URL. Claude Code POSTs to `${baseUrl}/v1/messages`. For an Astrale model node: https://<gateway-host>/v1/models/<modelNodeId>. The token audience is derived from this URL's origin."
              value={baseUrl}
              onChange={setBaseUrl}
              placeholder="https://ai-gateway.astrale.ai/v1/models/<modelNodeId>"
            />
            <GatewayTextField
              label="Model label"
              hint="ANTHROPIC_MODEL — shown in ACP diagnostics and sent as the request `model`. Cosmetic: an Astrale gateway pins the real model by URL, so this is just a name (e.g. glm-5.2)."
              value={model}
              onChange={setModel}
              placeholder="glm-5.2 (optional)"
            />
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                Authentication
                <SettingsHint text="How the harness gets its bearer token. Auto-mint: the studio mints a short-lived delegation token per run via `astrale token` (no secret stored) — best for Astrale gateways. Static token: a bearer you paste." />
              </span>
              <div
                className="grid grid-cols-2 gap-1 rounded-md bg-muted/45 p-1"
                role="radiogroup"
                aria-label="Auth mode"
              >
                {AUTH_MODES.map((candidate) => (
                  <button
                    key={candidate.mode}
                    type="button"
                    role="radio"
                    aria-checked={mode === candidate.mode}
                    onClick={() => setMode(candidate.mode)}
                    className={cn(
                      'rounded px-1.5 py-1 text-center text-[11px] font-medium transition-colors',
                      mode === candidate.mode
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {candidate.label}
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
                    className={FIELD}
                  />
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
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
                      onChange={(event) => setToken(event.target.value)}
                      placeholder="bearer token (e.g. astrale token --audience <gateway-origin>)"
                      spellCheck={false}
                      autoComplete="off"
                      className={cn(FIELD, 'min-w-0')}
                    />
                    <button
                      type="button"
                      onClick={() => setReveal(!reveal)}
                      title={reveal ? 'Hide' : 'Reveal'}
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {reveal ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Stored locally under ~/.astrale/studio. It will stop working when the token
                    expires.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-0.5">
          <Button
            size="xs"
            disabled={!gateway || gatewayFetching || !!validationError || save.isPending}
            onClick={() =>
              save.mutate({
                enabled,
                baseUrl: baseUrl.trim(),
                model: model.trim() || undefined,
                auth: buildAuth(),
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save for this machine'}
          </Button>
          {gateway?.config != null && (
            <Button
              size="xs"
              variant="ghost"
              disabled={gatewayFetching || reset.isPending}
              onClick={() => reset.mutate()}
              title="Remove the machine gateway configuration and use the harness default auth"
            >
              Clear
            </Button>
          )}
        </div>
        {validationError && <p className="text-[11px] text-destructive">{validationError}</p>}
      </div>
    </div>
  )
}
