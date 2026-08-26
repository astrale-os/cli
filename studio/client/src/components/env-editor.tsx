import type { EnvName, EnvVarRow } from '@shared/types'

/**
 * env-editor.tsx — the Settings "Environment" section. Reads/parses `.env.<env>`
 * and reconciles it against env.ts's `Env` contract, then EDITS it (the read-only
 * studio's one sanctioned domain-file writer). dev/prod selector. A declared,
 * required (non-optional) field with no value is the signal the workflow leans on:
 * the agent declares a new env in env.ts → it shows here as "required" → fill it.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Eye, EyeOff, KeyRound, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { api, qk } from '@/lib/api'
import { useEnv } from '@/lib/hooks'
import { useUI } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * The header chip — shown ONLY when the dev env has REQUIRED (non-optional) vars
 * declared in env.ts but still empty (e.g. the agent just added an integration's
 * key). Invisible otherwise. Clicking opens Settings → Environment to fill them.
 */
export function EnvBadge({ domainId }: { domainId: string }) {
  const { data } = useEnv(domainId, 'dev')
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const n = data?.requiredMissing ?? 0
  if (n === 0) return null
  return (
    <button
      type="button"
      onClick={() => setSettingsOpen(true)}
      title={`${n} required env var${n === 1 ? '' : 's'} need a value — open Settings → Environment`}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
    >
      <KeyRound className="h-3.5 w-3.5" />
      <span>{n} env</span>
      <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
    </button>
  )
}

function rowStatus(r: EnvVarRow, value: string): { dot: string; label: string; tone: string } {
  if (!r.declared) return { dot: 'bg-warning', label: 'orphan', tone: 'text-warning' }
  if (!r.optional && value === '')
    return { dot: 'bg-destructive', label: 'required', tone: 'text-destructive' }
  if (value === '')
    return { dot: 'bg-muted-foreground/40', label: 'optional', tone: 'text-muted-foreground' }
  return { dot: 'bg-success', label: 'set', tone: 'text-muted-foreground' }
}

const ENVS: EnvName[] = ['dev', 'prod']

export function EnvEditor({ domainId }: { domainId?: string }) {
  const [env, setEnvSel] = useState<EnvName>('dev')
  const { data, isLoading } = useEnv(domainId, env)
  const qc = useQueryClient()
  const [edits, setEdits] = useState<Record<string, string | null>>({})
  const [reveal, setReveal] = useState<Set<string>>(() => new Set())

  // drop local edits when the env or domain changes (fresh file, fresh slate)
  useEffect(() => {
    setEdits({})
    setReveal(new Set())
  }, [env, domainId])

  const save = useMutation({
    mutationFn: () => api.setEnv(domainId!, env, edits),
    onSuccess: (model) => {
      qc.setQueryData(qk.env(domainId!, env), model)
      setEdits({})
      toast.success(`Saved ${model.file}`)
    },
    onError: (e) => toast.error(String(e)),
  })

  const rows = (data?.rows ?? []).filter((r) => edits[r.name] !== null) // hide rows queued for delete
  const dirty = Object.keys(edits).length > 0
  const valueOf = (r: EnvVarRow) => (r.name in edits ? (edits[r.name] ?? '') : r.value)
  const toggleReveal = (name: string) =>
    setReveal((s) => {
      const next = new Set(s)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Environment
        </span>
        {/* dev / prod selector */}
        <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
          {ENVS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEnvSel(e)}
              className={cn(
                'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                env === e
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      {/* status line: which file, whether it's wired, how it ships, missing count */}
      {data && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[11px] text-muted-foreground">
          <span className="font-mono">{data.file}</span>
          {!data.exists && <span>· new on save</span>}
          {!data.configured && <span className="text-warning">· not wired in astrale.config</span>}
          {env === 'prod' && data.adapter === 'astrale' && (
            <span>· managed prod → platform store on `pnpm prod`</span>
          )}
          {data.requiredMissing > 0 && (
            <span className="font-medium text-destructive">
              · {data.requiredMissing} required missing
            </span>
          )}
        </div>
      )}

      <div className="divide-y rounded-lg border bg-card">
        {isLoading && !data ? (
          <div className="px-3 py-2.5 text-[12px] text-muted-foreground">Loading {env} env…</div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-2.5 text-[12px] text-muted-foreground">
            No variables declared in env.ts and none set in {data?.file}.
          </div>
        ) : (
          rows.map((r) => {
            const value = valueOf(r)
            const st = rowStatus(r, value)
            const shown = reveal.has(r.name)
            return (
              <div key={r.name} className="space-y-1 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn('h-1.5 w-1.5 shrink-0 rounded-full', st.dot)}
                    title={st.label}
                  />
                  <span className="truncate font-mono text-[12px]">{r.name}</span>
                  <span className={cn('shrink-0 text-[10px]', st.tone)}>{st.label}</span>
                  <div className="ml-auto flex min-w-0 flex-1 items-center gap-1">
                    <input
                      type={shown ? 'text' : 'password'}
                      value={value}
                      onChange={(e) => setEdits((s) => ({ ...s, [r.name]: e.target.value }))}
                      placeholder={!r.optional && r.declared ? 'required — set a value' : 'unset'}
                      spellCheck={false}
                      autoComplete="off"
                      className="w-full min-w-0 rounded-md border bg-card px-2 py-1 font-mono text-[12px] outline-none placeholder:text-muted-foreground focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => toggleReveal(r.name)}
                      title={shown ? 'Hide' : 'Reveal'}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    {!r.declared && (
                      <button
                        type="button"
                        onClick={() => setEdits((s) => ({ ...s, [r.name]: null }))}
                        title="Remove this variable from the file"
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {r.doc && (
                  <p className="pl-3.5 text-[11px] leading-snug text-muted-foreground">{r.doc}</p>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-2 px-1">
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <AlertTriangle className="h-3 w-3" /> Plaintext in {data?.file ?? `.env.${env}`}{' '}
          (gitignored) · edits the file, not a deploy
        </p>
        {dirty && (
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Save {env}
          </button>
        )}
      </div>
    </div>
  )
}
