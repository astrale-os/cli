import type { HarnessGatewayAuth, HarnessStatus } from '@shared/types'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { useHarnessGateway } from '@/lib/hooks'

import { embeddedStudio, GatewayAuthFields, type GatewayAuthMode } from './gateway-auth'
import { GatewayHeading, GatewayTextField } from './gateway-fields'
import { validateGatewayDraft } from './gateway-validation'
import { SettingsHint } from './hint'

interface GatewaySaveInput {
  domainId: string
  scope: 'domain' | 'global'
  config: {
    enabled: boolean
    baseUrl: string
    model?: string
    auth: HarnessGatewayAuth
  }
}

/** Per-domain or global Anthropic-compatible gateway configuration. */
export function HarnessGatewaySettings({
  domainId,
  harness,
}: {
  domainId?: string
  harness?: HarnessStatus
}) {
  const anthropic = harness?.capabilities.gateway === 'anthropic'
  const { data: gateway, isFetching: gatewayFetching } = useHarnessGateway(
    anthropic ? domainId : undefined,
  )
  const queryClient = useQueryClient()

  const [enabled, setEnabled] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [mode, setMode] = useState<GatewayAuthMode>(embeddedStudio ? 'host' : 'mint')
  const [instance, setInstance] = useState('')
  const [token, setToken] = useState('')
  const [applyToAll, setApplyToAll] = useState(false)
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    const effective = gateway?.local ?? gateway?.global ?? null
    setEnabled(effective?.enabled ?? false)
    setBaseUrl(effective?.baseUrl ?? '')
    setModel(effective?.model ?? '')
    setMode(effective?.auth.mode ?? (embeddedStudio ? 'host' : 'mint'))
    setInstance(effective?.auth.mode === 'mint' ? (effective.auth.instance ?? '') : '')
    setToken(effective?.auth.mode === 'token' ? effective.auth.token : '')
    setApplyToAll(gateway?.local == null && gateway?.global != null)
    setReveal(false)
  }, [domainId, gateway])

  const buildAuth = (): HarnessGatewayAuth => {
    if (mode === 'token') return { mode: 'token', token: token.trim() }
    if (mode === 'host') return { mode: 'host' }
    return { mode: 'mint', ...(instance.trim() ? { instance: instance.trim() } : {}) }
  }
  const validationError = validateGatewayDraft(enabled, baseUrl, mode, token)

  const save = useMutation({
    mutationFn: (input: GatewaySaveInput) =>
      api.setHarnessGateway(input.domainId, input.scope, input.config),
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: qk.harnessGateway(input.domainId) })
      queryClient.invalidateQueries({ queryKey: qk.loadout(input.domainId) })
      toast.success(input.scope === 'global' ? 'Saved for all domains' : 'Saved for this domain')
    },
    onError: (error) => toast.error(String(error)),
  })

  const reset = useMutation({
    mutationFn: (id: string) => api.clearHarnessGateway(id, 'domain'),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: qk.harnessGateway(id) })
      queryClient.invalidateQueries({ queryKey: qk.loadout(id) })
      toast.success('Override removed — inheriting the default')
    },
    onError: (error) => toast.error(String(error)),
  })

  if (harness && !anthropic)
    return (
      <div>
        <GatewayHeading status="not applicable" />
        <div className="rounded-lg border bg-card/40 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
          {harness.id === 'codex'
            ? 'Codex uses its own local login. The Astrale gateway currently exposes Chat Completions and Anthropic Messages, while Codex custom providers require the Responses API.'
            : `${harness.label} does not expose a Studio model-gateway adapter.`}
        </div>
      </div>
    )

  const source = gateway?.source ?? 'none'
  const sourceLabel =
    source === 'domain'
      ? 'active for this domain'
      : source === 'global'
        ? 'inherited from the studio-wide default'
        : 'off — the harness uses its own Claude Code auth'

  return (
    <div>
      <GatewayHeading status={sourceLabel} help />
      <div className="space-y-2.5 rounded-lg border bg-card/40 px-3 py-2.5">
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
              hint="ANTHROPIC_MODEL — shown in the loadout and sent as the request `model`. Cosmetic: an Astrale gateway pins the real model by URL, so this is just a name (e.g. glm-5.2)."
              value={model}
              onChange={setModel}
              placeholder="glm-5.2 (optional)"
            />
            <GatewayAuthFields
              mode={mode}
              setMode={setMode}
              instance={instance}
              setInstance={setInstance}
              token={token}
              setToken={setToken}
              reveal={reveal}
              setReveal={setReveal}
            />
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2 border-t pt-2.5 text-[12px]">
          <input
            type="checkbox"
            checked={applyToAll}
            onChange={(event) => setApplyToAll(event.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          <span className="flex items-center gap-1.5">
            Apply to all domains
            <SettingsHint text="Save as the studio-wide default for every domain (and clear this domain's own override so it inherits it). Off ⇒ this setting applies to THIS domain only. Either way it never leaks outside the studio." />
          </span>
        </label>

        <div className="flex items-center gap-2 pt-0.5">
          <button
            type="button"
            disabled={
              !domainId || !gateway || gatewayFetching || !!validationError || save.isPending
            }
            onClick={() =>
              save.mutate({
                domainId: domainId!,
                scope: applyToAll ? 'global' : 'domain',
                config: {
                  enabled,
                  baseUrl: baseUrl.trim(),
                  model: model.trim() || undefined,
                  auth: buildAuth(),
                },
              })
            }
            className="rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {save.isPending
              ? 'Saving…'
              : applyToAll
                ? 'Save for all domains'
                : 'Save for this domain'}
          </button>
          {gateway?.local != null && (
            <button
              type="button"
              disabled={gatewayFetching || reset.isPending}
              onClick={() => reset.mutate(domainId!)}
              className="rounded-md px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              title="Remove this domain's override and inherit the studio-wide default (or default auth)"
            >
              Reset to default
            </button>
          )}
        </div>
        {validationError && <p className="text-[11px] text-destructive">{validationError}</p>}
      </div>
    </div>
  )
}
