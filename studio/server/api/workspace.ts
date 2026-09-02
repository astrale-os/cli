import { agentWorkspace } from '../agent/workspace'
/** Workspace-wide routes that do not require a DomainHandle. */
import { invalidate } from '../cache'
import { allDomains, depsInstalled } from '../domain'
import { activeInstanceName, listInstances, setActiveInstance } from '../instances/active'
import { asJsonRecord, asString } from '../json'
import { updateSettings } from '../state/settings'
import { readWorkspaceUiState, updateWorkspaceUiState } from '../state/workspace-ui'
import { settingsRoot, studioSettings } from '../studio-settings'
import { buildCatalog } from '../workspace/catalog'
import { createDomain } from '../workspace/create'
import { detectGit } from '../workspace/git'
import { badRequest, json, readJsonRecord, type Notify } from './http'

export async function handleWorkspaceRoute(
  req: Request,
  path: string,
  notify: Notify,
): Promise<Response | null> {
  if (path === '/api/workspace') {
    // The registry answers this, NOT the bundles. Every read of the studio is gated
    // on this list — it is what turns "Connecting to studio…" into an interface —
    // and awaiting a bundle per domain to read one string held the whole UI behind
    // an extraction of the entire workspace. A domain not indexed yet answers under
    // its directory name and is announced again, under its origin, the moment its
    // bundle lands (see index.ts / watch.ts).
    const domains = allDomains().map((handle) => ({
      id: handle.id,
      origin: handle.origin || handle.id,
      path: handle.root,
      schemaDir: handle.schemaDirName,
      depsInstalled: depsInstalled(handle.root),
      hasGit: detectGit(handle.root).hasGit,
      configFile: handle.configFile,
    }))
    return json(domains)
  }

  if (path === '/api/workspace/state') {
    const root = agentWorkspace().uiRoot
    if (req.method === 'GET') return json(readWorkspaceUiState(root))
    if (req.method === 'POST') {
      const body = await readJsonRecord(req)
      if (body.action !== 'update') return badRequest('unknown workspace state action')
      return json(updateWorkspaceUiState(root, body.state))
    }
    return badRequest('GET or POST')
  }

  if (path === '/api/workspace/create' && req.method === 'POST') {
    const body = await readJsonRecord(req)
    const result = await createDomain(asString(body.name) ?? '', await activeInstanceName())
    if (result.ok) notify({ type: 'workspace', domains: allDomains().map((domain) => domain.id) })
    return json(result)
  }

  if (path === '/api/catalog') {
    return json(
      buildCatalog(
        allDomains().map((handle) => ({
          origin: handle.origin ?? handle.id,
          id: handle.id,
        })),
      ),
    )
  }

  if (path === '/api/settings') {
    if (req.method === 'GET') return json(studioSettings())
    if (req.method === 'POST') {
      const body = await readJsonRecord(req)
      if (body.action !== 'update') return badRequest('unknown settings action')
      const next = updateSettings(settingsRoot(), asJsonRecord(body.settings) ?? {})
      // `integrationsDir` is read while composing every domain's anatomy, so a settings
      // write is news to all of them — not to the one that happened to be on screen.
      for (const handle of allDomains()) {
        invalidate(handle.id, 'anatomy')
        notify({ type: 'anatomy-diff', domainId: handle.id })
      }
      return json(next)
    }
    return badRequest('GET or POST')
  }

  if (path === '/api/instances' && req.method === 'GET') return json(await listInstances())
  if (path === '/api/instances/use' && req.method === 'POST') {
    const body = await readJsonRecord(req)
    const name = (asString(body.name) ?? '').trim()
    if (!name) return badRequest('name is required')
    return json(await setActiveInstance(name))
  }

  return null
}
