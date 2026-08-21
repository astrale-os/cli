/** Workspace-wide routes that do not require a DomainHandle. */
import { getBundle } from '../cache'
import { allDomains, depsInstalled } from '../domain'
import { activeInstanceName, listInstances, setActiveInstance } from '../instances/active'
import { buildCatalog } from '../workspace/catalog'
import { createDomain } from '../workspace/create'
import { detectGit } from '../workspace/git'
import { badRequest, json, type Notify } from './http'

export async function handleWorkspaceRoute(
  req: Request,
  path: string,
  notify: Notify,
): Promise<Response | null> {
  if (path === '/api/workspace') {
    const domains = await Promise.all(
      allDomains().map(async (handle) => {
        const bundle = await getBundle(handle.id)
        return {
          id: handle.id,
          origin: bundle?.overlay.origin || handle.origin || handle.id,
          path: handle.root,
          schemaDir: handle.schemaDirName,
          depsInstalled: depsInstalled(handle.root),
          hasGit: detectGit(handle.root).hasGit,
          configFile: handle.configFile,
        }
      }),
    )
    return json(domains)
  }

  if (path === '/api/workspace/create' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const result = await createDomain(String(body.name ?? ''), await activeInstanceName())
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

  if (path === '/api/instances' && req.method === 'GET') return json(await listInstances())
  if (path === '/api/instances/use' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const name = String(body.name ?? '').trim()
    if (!name) return badRequest('name is required')
    return json(await setActiveInstance(name))
  }

  return null
}
