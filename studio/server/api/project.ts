/** Domain project configuration routes: settings and env files. */
import { invalidate } from '../cache'
import { isEnvName, readEnvModel, writeEnvUpdates } from '../environment/files'
import { readSettings, updateSettings } from '../state/settings'
import { badRequest, json, type DomainRouteContext } from './http'

export async function handleProjectRoute(context: DomainRouteContext): Promise<Response | null> {
  const { req, url, rest, body, handle, notify } = context
  const id = handle.id
  const root = handle.root

  if (rest === '/settings') {
    if (req.method === 'GET') return json(readSettings(root))
    if (body.action === 'update') {
      const next = updateSettings(root, body.settings ?? {})
      invalidate(id, 'anatomy')
      notify({ type: 'anatomy-diff', domainId: id })
      return json(next)
    }
    return badRequest('unknown settings action')
  }

  if (rest === '/env') {
    const envName = req.method === 'GET' ? url.searchParams.get('env') : body.env
    if (!isEnvName(envName)) return badRequest('env must be "dev" or "prod"')
    if (req.method === 'GET') return json(readEnvModel(root, envName))
    if (req.method === 'POST') {
      if (!body.updates || typeof body.updates !== 'object') {
        return badRequest('updates object required')
      }
      const updates: Record<string, string | null> = {}
      for (const [key, value] of Object.entries(body.updates as Record<string, unknown>)) {
        if (!/^[A-Za-z_]\w*$/.test(key)) continue
        updates[key] = value === null ? null : String(value)
      }
      try {
        const model = writeEnvUpdates(root, envName, updates)
        notify({ type: 'anatomy-diff', domainId: id })
        return json(model)
      } catch (error: any) {
        return badRequest(String(error?.message ?? error))
      }
    }
    return badRequest('GET or POST')
  }

  return null
}
