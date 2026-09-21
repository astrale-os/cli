import { z } from 'zod'

import { AstraleError } from '../../errors'
import { traceId } from './trace'

/** Read-only Tempo transport. Credentials stay in headers and are never part of the dossier. */
export function createTempoReader(
  options: {
    tempoUrl?: string
    cockpitUrl?: string
    datasource?: string
    token?: string
    scalewayKey?: string
    timeoutMs?: number
  },
  fetcher: typeof fetch = fetch,
) {
  if (Boolean(options.tempoUrl) === Boolean(options.cockpitUrl))
    throw new TypeError('Select exactly one Tempo or Cockpit URL')
  const base = new URL(options.tempoUrl ?? options.cockpitUrl!)
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new TypeError('Invalid telemetry URL')
  let cookie: string | undefined
  let datasource = options.datasource
  const fetchResponse = (url: string, headers: Record<string, string>) =>
    fetcher(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
    })
  async function login() {
    if (!options.scalewayKey) throw new TypeError('Cockpit requires SCW_API_KEY')
    const response = await fetchResponse(`${base.origin}/login`, {
      'X-Auth-Token': options.scalewayKey,
    })
    if (response.status !== 200 && response.status !== 302)
      throw new AstraleError(
        'TELEMETRY_AUTH_FAILED',
        `Cockpit login failed (HTTP ${response.status})`,
      )
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    if (!cookie)
      throw new AstraleError('TELEMETRY_AUTH_FAILED', 'Cockpit login returned no session cookie')
  }
  async function json(path: string) {
    if (options.cockpitUrl && !cookie) await login()
    const headers = (): Record<string, string> =>
      options.cockpitUrl
        ? { Cookie: cookie! }
        : options.token
          ? { Authorization: `Bearer ${options.token}` }
          : {}
    let response = await fetchResponse(`${base.href.replace(/\/$/, '')}${path}`, headers())
    // Only an expired Cockpit session can renew. A forbidden read is never retried under another authority.
    if (response.status === 401 && options.cockpitUrl) {
      await login()
      response = await fetchResponse(`${base.href.replace(/\/$/, '')}${path}`, headers())
    }
    if (!response.ok)
      throw new AstraleError(
        'TELEMETRY_READ_FAILED',
        `Telemetry read failed (HTTP ${response.status})`,
      )
    return response.json() as Promise<unknown>
  }
  async function tempo(path: string) {
    if (!options.cockpitUrl) return json(path)
    if (!datasource) {
      const sources = z
        .array(z.object({ uid: z.string(), type: z.string() }))
        .parse(await json('/api/datasources'))
        .filter((source) => source.type === 'tempo')
      if (sources.length !== 1)
        throw new TypeError('Select --tempo-datasource: Cockpit has no unique Tempo datasource')
      datasource = sources[0]!.uid
    }
    return json(`/api/datasources/proxy/uid/${encodeURIComponent(datasource)}${path}`)
  }
  return {
    trace: (id: string) => tempo(`/api/traces/${traceId(id)}`),
    async search(
      instance: string,
      operation: string,
      since: string,
      until: string,
      maxRequests = 64,
    ) {
      const from = Math.floor(Date.parse(since) / 1000)
      const to = Math.ceil(Date.parse(until) / 1000)
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to)
        throw new TypeError('Invalid trace search window')
      const pending: [number, number][] = [[from, to]]
      const ids = new Set<string>()
      const reasons = new Set<string>()
      let requests = 0
      while (pending.length && requests < maxRequests) {
        const [start, end] = pending.pop()!
        const query = new URLSearchParams({
          q: `{ resource.service.instance.id = ${JSON.stringify(instance)} && span.astrale.operation.id = ${JSON.stringify(operation)} }`,
          start: String(start),
          end: String(end),
          limit: '100',
        })
        const result = z
          .object({
            traces: z.array(z.object({ traceID: z.string() })).default([]),
            metrics: z
              .object({ completedJobs: z.number().optional(), totalJobs: z.number().optional() })
              .optional(),
          })
          .parse(await tempo(`/api/search?${query}`))
        requests++
        for (const item of result.traces) ids.add(traceId(item.traceID))
        const metrics = result.metrics
        if (metrics?.totalJobs === undefined || metrics.completedJobs === undefined)
          reasons.add('search-coverage-unavailable')
        else if (metrics.completedJobs < metrics.totalJobs) reasons.add('search-jobs-incomplete')
        if (result.traces.length >= 100) {
          if (end - start <= 1) reasons.add('search-result-limit')
          else {
            const middle = Math.floor((start + end) / 2)
            pending.push([start, middle], [middle, end])
          }
        }
      }
      if (pending.length) reasons.add('search-request-limit')
      return {
        traceIds: [...ids],
        coverage: {
          status: reasons.size ? 'partial' : 'complete',
          reasons: [...reasons],
          requests,
          since,
          until,
          sampling: 'unknown',
        },
      }
    },
  }
}
