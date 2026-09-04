import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import { createPathCall, type ConnectionContext } from '../connection'
import { AstraleError } from '../errors'
import { prepareQuery } from '../graph'

const nodePath = z.string().regex(/^@[A-Za-z0-9._-]+$/u)
const status = z.object({
  instance: nodePath,
  slug: z.string(),
  issuer: z.url(),
  desired: z.object({
    state: z.enum(['running', 'stopped', 'deleting']),
    generation: z.number().int().positive(),
  }),
  observed: z.object({
    state: z.enum(['pending', 'starting', 'ready', 'stopping', 'stopped', 'deleting', 'failed']),
    generation: z.number().int().nonnegative(),
    failure: z.object({ message: z.string() }).optional(),
  }),
  route: z.object({ state: z.enum(['withdrawn', 'published']), url: z.url().optional() }),
})
export type HostInstance = z.infer<typeof status>

export async function hostCall(context: ConnectionContext, path: string, input: object) {
  const response = await context.session.dispatch(createPathCall(path, input))
  if (response.kind !== 'value')
    throw new AstraleError('HOST_RESPONSE_INVALID', 'Expected a Host value response.')
  return response.value
}

export async function findHostInstance(context: ConnectionContext, slug: string) {
  let cursor: string | undefined
  do {
    const query = prepareQuery({ sources: [], class: '/:host.astrale.ai:class.Instance', cursor })
    const result = await context.graph.query(query.ast, { page: query.page })
    if (result.result.kind !== 'graph')
      throw new AstraleError('HOST_RESPONSE_INVALID', 'Expected a Host Instance graph.')
    const found = result.result.graph.nodes.find(
      (node) => node.props['host.astrale.ai:class.Instance.property.slug'] === slug,
    )
    if (found) return readHostInstance(context, `@${found.id}`)
    cursor = result.page?.next
  } while (cursor !== undefined)
  return undefined
}

export async function readHostInstance(context: ConnectionContext, instance: string) {
  const result = status.parse(await hostCall(context, `${instance}::status`, {}))
  if (result.instance !== instance)
    throw new AstraleError('HOST_INSTANCE_MISMATCH', 'Host status belongs to another child.')
  return result
}

/** Reconcile one exact child; retries reuse the admitted Host slug and generation. */
export async function ensureHostInstance(
  context: ConnectionContext,
  slug: string,
): Promise<HostInstance> {
  const manager = new URL(context.target.kernelIssuer)
  if (!manager.pathname.endsWith('/host')) {
    throw new AstraleError('HOST_TARGET_INVALID', 'The Host manager issuer must end in /host.')
  }
  manager.pathname = `${manager.pathname.slice(0, -4)}${slug}`
  const issuer = manager.href
  let instance = await findHostInstance(context, slug)
  if (instance === undefined) {
    const receipt = z.object({ instance: nodePath }).parse(
      await hostCall(context, '/:host.astrale.ai:core.manager::createInstance', {
        operationId: randomUUID(),
        slug,
        issuer,
      }),
    )
    instance = await readHostInstance(context, receipt.instance)
  }
  const deadline = Date.now() + 120_000
  for (;;) {
    if (instance.issuer !== issuer || instance.slug !== slug) {
      throw new AstraleError(
        'HOST_INSTANCE_MISMATCH',
        'The retained child has different identity coordinates.',
      )
    }
    if (instance.observed.state === 'failed' || instance.desired.state !== 'running') {
      throw new AstraleError(
        'HOST_INSTANCE_NOT_READY',
        instance.observed.failure?.message ?? `Child is ${instance.observed.state}.`,
      )
    }
    if (
      instance.observed.state === 'ready' &&
      instance.observed.generation === instance.desired.generation &&
      instance.route.state === 'published' &&
      instance.route.url === issuer
    )
      return instance
    if (Date.now() >= deadline)
      throw new AstraleError(
        'HOST_INSTANCE_PENDING',
        `Child ${slug} is still starting; retry the same command to reconnect.`,
      )
    await new Promise((resolve) => setTimeout(resolve, 500))
    instance = await readHostInstance(context, instance.instance)
  }
}
