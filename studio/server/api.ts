/**
 * api.ts — the JSON API router. Pure read endpoints come from the cache; writes
 * go through the allow-listed state modules. Returns null for non-/api paths.
 */
import type { StudioEvent } from '../shared/types'

import { handleAgentRoute } from './agent/routes'
import { getBundle, getAnatomy, getCore, invalidate } from './cache'
import { type DomainHandle, allDomains, depsInstalled, getDomain } from './domain'
import { schemaRefs } from './introspect/schema-refs'
import { buildCatalog } from './state/catalog'
import {
  addThreadEntry,
  deleteComment,
  editThreadEntry,
  markOrphans,
  mergeReply,
  readComments,
  setStatus,
  upsertComment,
} from './state/comments'
import {
  addUserContext,
  deleteContext,
  readContext,
  setAutoInclude,
  updateContext,
} from './state/context'
import { buildCopyMarkdown } from './state/copy'
import { createDomain } from './state/create'
import {
  addDocument,
  deleteDocument,
  listDocuments,
  readDocument,
  updateDocument,
} from './state/documents'
import { isEnvName, readEnvModel, writeEnvUpdates } from './state/env'
import { detectGit } from './state/git'
import { refreshAuto } from './state/handoff'
import {
  activeInstanceName,
  instanceStatus,
  listInstances,
  runDeploy,
  setActiveInstance,
} from './state/instance'
import { deleteIntegration, readIntegrations, upsertIntegration } from './state/integrations'
import { readLayout, resetLayout, saveLayout, setNodePositions } from './state/layout'
import { readSettings, updateSettings } from './state/settings'
import { applyUpdates, getUpdates } from './state/updates'
import { closeViewSession, getViewRuntime, launchViewSession } from './state/views'
import { readVisibility, resetVisibility, saveVisibility } from './state/visibility'
import { restartViewDevServer } from './view-dev-server'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
const notFound = () => json({ error: 'not found' }, 404)
const badReq = (m: string) => json({ error: m }, 400)

/** The deploy-target INSTANCE name, or null for route-based / unset targets (which have no instance to query). */
function instanceTarget(prodTarget?: string): string | null {
  const m = prodTarget?.match(/^instance:\s*(.+)$/)
  return m ? m[1].trim() || null : null
}

/**
 * Block cross-site state-changing requests (CSRF defense-in-depth on top of the
 * loopback bind). A mutation triggers the local agent (file edits + shell), so a
 * malicious page the user visits must NOT be able to POST here. The studio's own
 * SPA is same-origin; curl/CLI/the MCP bridge send no Origin/Sec-Fetch-Site.
 */
function crossSiteBlocked(req: Request, url: URL): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return false
  const sfs = req.headers.get('sec-fetch-site')
  if (sfs) return !(sfs === 'same-origin' || sfs === 'none')
  const origin = req.headers.get('origin')
  if (origin) {
    try {
      return new URL(origin).host !== url.host
    } catch {
      return true
    }
  }
  return false // no Origin + no Sec-Fetch-Site → a non-browser client (curl/CLI/MCP)
}

export type Notify = (e: StudioEvent) => void

export async function handleApi(req: Request, url: URL, notify: Notify): Promise<Response | null> {
  const path = url.pathname
  if (!path.startsWith('/api/')) return null
  if (crossSiteBlocked(req, url)) return json({ error: 'cross-site request blocked' }, 403)

  if (path === '/api/workspace') {
    const out = await Promise.all(
      allDomains().map(async (h) => {
        const bundle = await getBundle(h.id)
        return {
          id: h.id,
          origin: bundle?.overlay.origin || h.origin || h.id,
          path: h.root,
          schemaDir: h.schemaDirName,
          depsInstalled: depsInstalled(h.root),
          hasGit: detectGit(h.root).hasGit,
          configFile: h.configFile,
        }
      }),
    )
    return json(out)
  }

  // Scaffold a brand-new domain into the workspace (the one write that ADDS a domain).
  if (path === '/api/workspace/create' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const name = String(body.name ?? '')
    const result = await createDomain(name, await activeInstanceName())
    if (result.ok) notify({ type: 'workspace', domains: allDomains().map((d) => d.id) })
    return json(result) // 200 with {ok:false,error} on failure — the SPA reads the result shape
  }

  if (path === '/api/catalog') {
    return json(buildCatalog(allDomains().map((h) => ({ origin: h.origin ?? h.id, id: h.id }))))
  }

  // ── instances (GLOBAL — the active instance is CLI-owned, not per-domain) ──
  if (path === '/api/instances' && req.method === 'GET') return json(await listInstances())
  if (path === '/api/instances/use' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const name = String(body.name ?? '').trim()
    if (!name) return badReq('name is required')
    return json(await setActiveInstance(name))
  }

  // /api/domain/:id/...
  const m = path.match(/^\/api\/domain\/([^/]+)(\/.*)?$/)
  if (!m) return notFound()
  const id = decodeURIComponent(m[1])
  const rest = m[2] ?? ''
  const handle = getDomain(id)
  if (!handle) return notFound()
  const root = handle.root

  // ── context documents (handled BEFORE the json body parse — uploads are multipart) ──
  if (rest === '/context/documents' && req.method === 'GET') return json(listDocuments(root))
  if (rest === '/context/documents' && req.method === 'POST') {
    const form = await req.formData()
    const added = []
    for (const value of form.getAll('files')) {
      if (value instanceof File)
        added.push(
          addDocument(root, value.name, value.type, new Uint8Array(await value.arrayBuffer())),
        )
    }
    return json(added)
  }
  const rawDoc = rest.match(/^\/context\/documents\/([^/]+)\/raw$/)
  if (rawDoc && req.method === 'GET') {
    const d = readDocument(root, decodeURIComponent(rawDoc[1]))
    if (!d) return notFound()
    return new Response(Bun.file(d.abs), { headers: { 'content-type': d.meta.type } })
  }

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}

  if (rest === '/context/documents/delete' && req.method === 'POST')
    return json({ ok: deleteDocument(root, body.id) })
  if (rest === '/context/documents/update' && req.method === 'POST') {
    const meta = updateDocument(root, body.id, new TextEncoder().encode(String(body.content ?? '')))
    return meta ? json(meta) : notFound()
  }

  // ── schema bundle ──
  if (rest === '/bundle') return json(await getBundle(id, url.searchParams.has('fresh')))
  if (rest === '/anatomy') return json(await getAnatomy(id, url.searchParams.has('fresh')))

  // ── update staleness (CLI + SDK deps, via `astrale update --check --json`) ──
  if (rest === '/updates' && req.method === 'GET') return json(await getUpdates(root))
  // ── apply the update (the "Update now" button) — runs `astrale update --yes` ──
  if (rest === '/updates/apply' && req.method === 'POST') return json(await applyUpdates(root))

  // ── core (genesis) data ──
  if (rest === '/core') return json(await getCore(id, url.searchParams.has('fresh')))

  // ── views: Studio-owned local Vite lifecycle + `astrale view` auth/session ──
  if (rest === '/views/dev-server/restart' && req.method === 'POST') {
    return json(await restartViewDevServer(root))
  }
  if (rest === '/views/sessions/close' && req.method === 'POST') {
    return json(await closeViewSession(String(body.sessionId ?? '')))
  }

  const viewRuntimeM = rest.match(/^\/views\/([^/]+)\/runtime$/)
  if (viewRuntimeM && req.method === 'GET') {
    const slug = decodeURIComponent(viewRuntimeM[1])
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) return badReq('invalid view slug')
    const anatomy = await getAnatomy(id)
    const view = anatomy?.views.find((candidate) => candidate.slug === slug)
    if (!view) return notFound()
    const bundle = await getBundle(id)
    const origin = bundle?.overlay.origin || anatomy?.overview.origin
    if (!origin) return badReq('domain origin is unavailable')
    return json(
      await getViewRuntime(root, origin, view, bundle, readSettings(root).viewProbeTimeoutMs),
    )
  }

  const viewSessionM = rest.match(/^\/views\/([^/]+)\/session$/)
  if (viewSessionM && req.method === 'POST') {
    const slug = decodeURIComponent(viewSessionM[1])
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) return badReq('invalid view slug')
    const anatomy = await getAnatomy(id)
    const view = anatomy?.views.find((candidate) => candidate.slug === slug)
    if (!view) return notFound()
    const bundle = await getBundle(id)
    const origin = bundle?.overlay.origin || anatomy?.overview.origin
    if (!origin) return badReq('domain origin is unavailable')
    return json(
      await launchViewSession(
        root,
        origin,
        view,
        bundle,
        body,
        readSettings(root).viewProbeTimeoutMs,
      ),
    )
  }

  // ── instance / deploy ──
  if (rest === '/instance') {
    const target = instanceTarget((await getAnatomy(id))?.overview.prodTarget)
    const bundle = await getBundle(id)
    return json(
      await instanceStatus(
        handle,
        target,
        bundle?.overlay.origin ?? null,
        bundle?.schemaHash ?? null,
      ),
    )
  }
  if (rest === '/instance/deploy' && req.method === 'POST') {
    const bundle = await getBundle(id)
    const result = await runDeploy(handle, bundle?.schemaHash ?? null)
    return json(result)
  }

  // ── comments ──
  if (rest === '/comments') {
    if (req.method === 'GET') {
      const bundle = await getBundle(id)
      // Valid schema targets come from the IR (authoritative), not source spans —
      // so inherited / span-less members are never falsely orphaned. Spans are
      // unioned in only as a belt-and-suspenders for refs the IR walk might miss.
      const valid = new Set<string>(bundle ? schemaRefs(bundle) : [])
      for (const k of Object.keys(bundle?.overlay.sourceSpans ?? {})) valid.add(k)
      const store = readComments(root)
      for (const c of store.comments)
        for (const a of c.anchorRefs) if (a.kind !== 'schema') valid.add(a.ref)
      return json(markOrphans(root, [...valid]))
    }
    if (body.action === 'create') {
      const bundle = await getBundle(id)
      const c = upsertComment(root, {
        anchors: body.anchors ?? [],
        anchorRefs: body.anchorRefs ?? [],
        text: body.text,
        firstRole: body.firstRole,
        type: body.type,
        options: body.options,
        schemaVersion: bundle?.schemaHash,
      })
      notify({ type: 'comments', domainId: id })
      return json(c)
    }
    if (body.action === 'reply') {
      const c = addThreadEntry(root, body.id, body.entry)
      notify({ type: 'comments', domainId: id })
      return c ? json(c) : notFound()
    }
    if (body.action === 'edit') {
      const c = editThreadEntry(root, body.id, body.entryId, String(body.text ?? ''))
      notify({ type: 'comments', domainId: id })
      return c ? json(c) : notFound()
    }
    if (body.action === 'status') {
      const c = setStatus(root, body.id, body.status, body.closeNote)
      notify({ type: 'comments', domainId: id })
      return c ? json(c) : notFound()
    }
    if (body.action === 'delete') {
      const ok = deleteComment(root, body.id)
      notify({ type: 'comments', domainId: id })
      return json({ ok })
    }
    return badReq('unknown comments action')
  }
  if (rest === '/comments/merge' && req.method === 'POST') {
    const bundle = await getBundle(id)
    try {
      const result = mergeReply(root, bundle?.schemaHash ?? '', String(body.text ?? ''), {
        dedupeAuthorText: true,
      })
      notify({ type: 'comments', domainId: id })
      return json(result)
    } catch (e: any) {
      return badReq(String(e?.message ?? e))
    }
  }

  const agentResponse = await handleAgentRoute({ req, url, rest, body, handle, notify })
  if (agentResponse) return agentResponse

  // ── context ──
  if (rest === '/context') {
    if (req.method === 'GET') return json(readContext(root))
    if (body.action === 'add') return notifyJson(notify, id, 'comments', addUserContext(root, body))
    if (body.action === 'update') {
      const it = updateContext(root, body.id, body)
      return it ? json(it) : notFound()
    }
    if (body.action === 'delete') return json({ ok: deleteContext(root, body.id) })
    if (body.action === 'include') {
      const it = setAutoInclude(root, body.id, body.include)
      return it ? json(it) : notFound()
    }
    return badReq('unknown context action')
  }

  // ── integrations ──
  if (rest === '/integrations') {
    const detected = (await getAnatomy(id))?.detectedIntegrations ?? []
    if (req.method === 'GET') return json(readIntegrations(root, detected))
    if (body.action === 'upsert') return json(upsertIntegration(root, body))
    if (body.action === 'delete') return json({ ok: deleteIntegration(root, body.id) })
    return badReq('unknown integrations action')
  }

  // ── settings (per-domain power-user overrides) ──
  if (rest === '/settings') {
    if (req.method === 'GET') return json(readSettings(root))
    if (body.action === 'update') {
      const next = updateSettings(root, body.settings ?? {})
      invalidate(id, 'anatomy') // integrationsDir changes what detection scans
      notify({ type: 'anatomy-diff', domainId: id })
      return json(next)
    }
    return badReq('unknown settings action')
  }

  // ── env vars editor: read/parse + WRITE `.env.<env>` (the read-only studio's one
  //    sanctioned domain-file writer), reconciled against env.ts's Env contract ──
  if (rest === '/env') {
    const envName = req.method === 'GET' ? url.searchParams.get('env') : body.env
    if (!isEnvName(envName)) return badReq('env must be "dev" or "prod"')
    if (req.method === 'GET') return json(readEnvModel(root, envName))
    if (req.method === 'POST') {
      if (!body.updates || typeof body.updates !== 'object')
        return badReq('updates object required')
      const updates: Record<string, string | null> = {}
      for (const [k, v] of Object.entries(body.updates as Record<string, unknown>)) {
        if (!/^[A-Za-z_]\w*$/.test(k)) continue // ignore bad keys
        updates[k] = v === null ? null : String(v)
      }
      try {
        const model = writeEnvUpdates(root, envName, updates)
        notify({ type: 'anatomy-diff', domainId: id }) // env.ts/.env changed — nudge consumers
        return json(model)
      } catch (e: any) {
        return badReq(String(e?.message ?? e))
      }
    }
    return badReq('GET or POST')
  }

  // ── graph layout (persisted manual positions) ──
  if (rest === '/layout') {
    const bundle = await getBundle(id)
    if (req.method === 'GET') return json(readLayout(root))
    if (body.action === 'set')
      return json(setNodePositions(root, body.positions ?? {}, bundle?.schemaHash))
    if (body.action === 'save')
      return json(saveLayout(root, body.positions ?? {}, bundle?.schemaHash))
    if (body.action === 'reset') {
      resetLayout(root)
      return json({ ok: true })
    }
    return badReq('unknown layout action')
  }

  // ── canvas visibility (persisted hide-set, inherited-edge toggle, interface nodes) ──
  if (rest === '/visibility') {
    if (req.method === 'GET') return json(readVisibility(root))
    if (body.action === 'set')
      return json(
        saveVisibility(root, {
          hidden: body.hidden ?? {},
          showInheritedEdges: body.showInheritedEdges ?? true,
          materializedInterfaces: body.materializedInterfaces ?? {},
        }),
      )
    if (body.action === 'reset') return json(resetVisibility(root))
    return badReq('unknown visibility action')
  }

  // ── copy payload ──
  if (rest === '/copy-payload' && req.method === 'POST') {
    await refreshAuto(handle)
    const bundle = await getBundle(id)
    const ctx = readContext(root)
    const open = readComments(root).comments.filter((c) => c.status === 'open')
    const md = buildCopyMarkdown({
      origin: bundle?.overlay.origin ?? id,
      root,
      schemaHash: bundle?.schemaHash ?? '',
      openComments: open,
      userContext: ctx.user,
      autoContext: body.includeAuto ? ctx.auto.filter((a) => a.includeInHandoff) : [],
      documents: listDocuments(root),
    })
    return json({ markdown: md, openComments: open.length })
  }

  return notFound()
}

function notifyJson(
  notify: Notify,
  id: string,
  type: StudioEvent['type'],
  data: unknown,
): Response {
  notify({ type, domainId: id } as StudioEvent)
  return json(data)
}
