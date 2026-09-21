import { z } from 'zod'

const attributes = z
  .array(
    z.object({
      key: z.string(),
      value: z
        .object({
          stringValue: z.string().optional(),
          intValue: z.union([z.string(), z.number()]).optional(),
          doubleValue: z.number().optional(),
          boolValue: z.boolean().optional(),
        })
        .passthrough(),
    }),
  )
  .default([])
const span = z
  .object({
    traceId: z.string(),
    spanId: z.string(),
    parentSpanId: z.string().optional(),
    name: z.string(),
    startTimeUnixNano: z.string(),
    endTimeUnixNano: z.string(),
    attributes,
    status: z.unknown().optional(),
  })
  .passthrough()
const batch = z.object({
  resource: z.object({ attributes }),
  scopeSpans: z.array(z.object({ spans: z.array(span) })).optional(),
  instrumentationLibrarySpans: z.array(z.object({ spans: z.array(span) })).optional(),
})
const trace = z.object({
  batches: z.array(batch).optional(),
  resourceSpans: z.array(batch).optional(),
})

export function traceId(value: string): string {
  if (/^[0-9a-f]{1,32}$/i.test(value)) return value.toLowerCase().padStart(32, '0')
  const bytes = Buffer.from(value, 'base64')
  if (
    bytes.length === 16 &&
    bytes.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')
  )
    return bytes.toString('hex')
  throw new TypeError('Invalid trace ID')
}

function facts(input: z.infer<typeof attributes>) {
  return Object.fromEntries(
    input.map(({ key, value }) => [
      key,
      value.stringValue ?? value.intValue ?? value.doubleValue ?? value.boolValue,
    ]),
  )
}

/** Decode OTLP from Tempo and keep only the requested physical Instance. */
export function inspectTrace(input: unknown, expectedTrace: string, instance: string) {
  const decoded = trace.parse(input)
  const spans = (decoded.batches ?? decoded.resourceSpans ?? []).flatMap((batch) => {
    const resource = facts(batch.resource.attributes)
    if (resource['service.instance.id'] !== instance) return []
    return (batch.scopeSpans ?? batch.instrumentationLibrarySpans ?? []).flatMap((scope) =>
      scope.spans.map((span) => {
        if (traceId(span.traceId) !== traceId(expectedTrace))
          throw new TypeError('Tempo returned a different trace')
        const start = BigInt(span.startTimeUnixNano)
        const end = BigInt(span.endTimeUnixNano)
        if (start < 0n || end < start) throw new TypeError('Invalid span timestamps')
        return {
          ...span,
          traceId: traceId(span.traceId),
          durationMs: Number(end - start) / 1e6,
          attributes: facts(span.attributes),
          resource,
        }
      }),
    )
  })
  if (spans.length === 0) throw new TypeError('No span matches the requested telemetry Instance')
  const issuers = [...new Set(spans.map((span) => span.resource['astrale.issuer']))]
  if (issuers.length !== 1 || typeof issuers[0] !== 'string')
    throw new TypeError('Trace has no unambiguous Instance issuer')
  const issuer = new URL(issuers[0])
  if (!['https:', 'http:'].includes(issuer.protocol) || issuer.username || issuer.password)
    throw new TypeError('Invalid Instance issuer')
  const times = spans.flatMap((span) => [
    Number(BigInt(span.startTimeUnixNano) / 1000000n),
    Number(BigInt(span.endTimeUnixNano) / 1000000n),
  ])
  return {
    traceId: traceId(expectedTrace),
    instance,
    issuer: issuers[0],
    spans,
    since: new Date(Math.min(...times) - 1000).toISOString(),
    until: new Date(Math.max(...times) + 1000).toISOString(),
    completeness: 'unknown' as const,
  }
}
