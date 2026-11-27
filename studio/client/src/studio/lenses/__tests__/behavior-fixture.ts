import type {
  DefinitionEffect,
  DefinitionLink,
  HandlerLink,
  IrClass,
  IrMethod,
  StudioSchemaBundle,
} from '@shared/contracts/schema'
import type { IrClassRef } from '@shared/schema/identity'

import { publishedDomainId } from '@shared/contracts/versions'

import {
  bundle,
  classRef,
  edgeClass,
  importClass,
  nodeClass,
} from '../../../schema-studio/__tests__/fixture'

/**
 * A Domain with behavior, as the source reading reports it: Methods over three modules and
 * one Domain function; mutations that create, update, delete and move state; Edge writes
 * that ride a Node created with them (through a base Class the end accepts), link two local
 * Classes, reach another Domain's single Class, or a union end; Integrations with an
 * operation another attempt may repeat, one whose declaration could not be read, and one no
 * handler reaches; and every kind of place the reading cannot follow.
 */

export const HOME = 'local.example.dev'
export const SHELL = 'shell.example.dev'

const local = (name: string) => classRef(HOME, name)
const shell = (name: string) => classRef(SHELL, name)

function endpoint(name: string, refs: IrClassRef[]) {
  return { name, types: refs.map((ref) => ref.name), refs }
}

function method(name: string, input: Partial<IrMethod> = {}): IrMethod {
  return {
    name,
    input: { type: 'object' },
    output: { mode: 'value', schema: { type: 'null' } },
    static: false,
    abstract: false,
    executable: true,
    ...input,
  }
}

function effect(
  kind: DefinitionEffect['kind'],
  className: string,
  input: Partial<DefinitionEffect> = {},
): DefinitionEffect {
  return { kind, class: className, verb: kind, file: 'src/mutations.ts', line: 1, ...input }
}

export function mutation(
  id: string,
  name: string,
  effects: DefinitionEffect[],
  input: Partial<DefinitionLink> = {},
): DefinitionLink {
  return {
    kind: 'mutation',
    id,
    name,
    file: 'src/mutations.ts',
    line: 1,
    classes: [...new Set(effects.map((one) => one.class))],
    effects,
    ...input,
  }
}

export function handler(
  owner: string,
  name: string,
  input: Partial<HandlerLink> = {},
): HandlerLink {
  return {
    owner,
    ownerKind: 'class',
    kind: 'action',
    method: name,
    static: false,
    implemented: true,
    ...input,
  }
}

const withMethods = (
  member: IrClass,
  names: readonly string[],
  abstract: readonly string[] = [],
) => ({
  ...member,
  methods: Object.fromEntries([
    ...names.map((name) => [name, method(name)] as const),
    ...abstract.map((name) => [name, method(name, { abstract: true, executable: false })] as const),
  ]),
})

const span = (file: string) => ({ file, startLine: 1, endLine: 1 })

export function behaviorBundle(): StudioSchemaBundle {
  const value = bundle({
    Resource: nodeClass('Resource'),
    Host: withMethods(nodeClass('Host', { extendsRefs: [local('Resource')] }), [
      'create',
      'assign',
      'release',
      'retire',
    ]),
    Fleet: withMethods(nodeClass('Fleet'), ['own', 'tag', 'inspect', 'sync'], ['plan']),
    Operation: withMethods(nodeClass('Operation'), ['note']),
    Note: nodeClass('Note'),
    hostedIn: edgeClass('hostedIn', [
      endpoint('resource', [local('Resource')]),
      endpoint('fleet', [local('Fleet')]),
    ]),
    memberOf: edgeClass('memberOf', [
      endpoint('host', [local('Host')]),
      endpoint('fleet', [local('Fleet')]),
    ]),
    ownedBy: edgeClass('ownedBy', [
      endpoint('owner', [shell('User')]),
      endpoint('owned', [local('Host'), local('Fleet')]),
    ]),
    tagged: edgeClass('tagged', [
      endpoint('subject', [local('Host'), local('Fleet')]),
      endpoint('by', [shell('Group'), shell('Role')]),
    ]),
  })
  for (const name of ['User', 'Group', 'Role'])
    importClass(value, shell(name), { ...nodeClass(name), origin: SHELL, ref: shell(name) })

  const ir = value.ir!
  ir.functions.provision = {
    name: 'provision',
    input: { type: 'object' },
    output: { mode: 'value', schema: { type: 'null' } },
  }

  value.overlay = {
    sourceSpans: {
      'class.Resource': span('schema/classes/resource.ts'),
      'class.Host': span('schema/modules/host/host.ts'),
      'class.Fleet': span('schema/modules/fleet/fleet.ts'),
      'class.Note': span('schema/modules/fleet/note.ts'),
      'class.Operation': span('schema/modules/operation/operation.ts'),
      'function.provision': span('schema/modules/host/provision.ts'),
    },
    definitions: [
      mutation('host.create', 'createHost', [
        effect('create', 'Host'),
        effect('create', 'hostedIn', { verb: 'createEdge' }),
      ]),
      mutation('host.assign', 'assignHost', [effect('create', 'memberOf', { verb: 'createEdge' })]),
      mutation('host.release', 'releaseHost', [
        effect('delete', 'memberOf', { verb: 'deleteEdge' }),
      ]),
      mutation('host.retire', 'retireHost', [
        effect('expect', 'Host', { verb: 'expect.count' }),
        effect('delete', 'Host'),
        effect('delete', 'hostedIn', { verb: 'deleteEdge' }),
        effect('transition', 'Operation', {
          property: 'status',
          from: 'running',
          event: 'finish',
          to: 'done',
        }),
      ]),
      mutation('fleet.own', 'ownFleet', [effect('create', 'ownedBy', { verb: 'createEdge' })]),
      mutation('fleet.tag', 'tagFleet', [effect('create', 'tagged', { verb: 'createEdge' })]),
      {
        kind: 'query',
        id: 'fleet.read',
        name: 'readFleet',
        file: 'src/queries.ts',
        line: 1,
        classes: ['Fleet'],
        effects: [effect('read', 'Fleet', { verb: 'where', role: 'root' })],
      },
      mutation(
        'provision.record',
        'recordProvision',
        [effect('update', 'Operation'), effect('update', 'Ghost')],
        {
          gaps: [
            {
              file: 'src/mutations.ts',
              line: 9,
              reason: 'names a Class the reading cannot tell: `declaredNode(record.class)`',
            },
          ],
        },
      ),
      mutation('unused.drop', 'dropUnused', [effect('delete', 'Note')]),
    ],
    handlerLinks: [
      handler('Host', 'create', {
        definitions: ['host.create'],
        integrations: ['machines.create', 'machines.status'],
      }),
      handler('Host', 'assign', { definitions: ['host.assign'] }),
      handler('Host', 'release', { definitions: ['host.release'] }),
      handler('Host', 'retire', {
        kind: 'workflow',
        definitions: ['host.retire'],
        calls: ['Host.release'],
      }),
      handler('Fleet', 'own', { definitions: ['fleet.own'] }),
      handler('Fleet', 'tag', { definitions: ['fleet.tag'] }),
      handler('Fleet', 'inspect', { definitions: ['fleet.read'] }),
      handler('Operation', 'note', { unlinked: true, implemented: false }),
      handler(HOME, 'provision', {
        ownerKind: 'function',
        definitions: ['provision.record', 'missing.one'],
        calls: ['Host.create'],
        integrations: ['routes.publish'],
        integrationGaps: [
          { file: 'src/provision.ts', line: 4, reason: 'hands the Integrations to a helper' },
        ],
      }),
    ],
    integrations: [
      {
        key: 'machines',
        id: 'local.machines',
        operations: [
          { name: 'create', replay: ['unsafe'] },
          { name: 'status', replay: ['safe'] },
        ],
      },
      { key: 'routes', id: 'local.routes' },
      { key: 'billing', id: 'local.billing', operations: [{ name: 'charge', replay: ['keyed'] }] },
    ],
  }
  return value
}

/** A Node path value naming `refs`, as the V1 DSL writes one. */
const nodePath = (refs: IrClassRef[]) => ({
  $ref: 'https://schemas.astrale.ai/graph/1/node-path',
  'x-astrale-path': { accepts: refs },
})

/**
 * The same Domain as a Publication of it reads: its Schema only, no handler source. `provision`
 * takes a Fleet and returns an Operation, so its signature names both.
 */
export function publishedBehaviorBundle(): StudioSchemaBundle {
  const value = behaviorBundle()
  value.domainId = publishedDomainId(HOME, '1.0.0')
  value.ir!.functions.provision = {
    name: 'provision',
    input: { type: 'object', properties: { fleet: nodePath([local('Fleet')]) } },
    output: { mode: 'value', schema: nodePath([local('Operation')]) },
  }
  // a list of a Class is that Class returned, as many times as the list holds
  value.ir!.functions.fleetHosts = {
    name: 'fleetHosts',
    input: { type: 'object', properties: {} },
    output: { mode: 'value', schema: { type: 'array', items: nodePath([local('Host')]) } },
  }
  value.overlay = { sourceSpans: {}, definitions: [], handlerLinks: [], integrations: [] }
  return value
}

/**
 * `writers` Methods on `Job`, each updating `Operation`, and one creating `Host`: as many
 * functions reaching one Class as `writers` says.
 */
export function hubBundle(writers: number): StudioSchemaBundle {
  const names = Array.from({ length: writers }, (_, index) => `step${index}`)
  const value = bundle({
    Job: withMethods(nodeClass('Job'), [...names, 'open']),
    Operation: nodeClass('Operation'),
    Host: nodeClass('Host'),
  })
  value.overlay = {
    sourceSpans: {},
    definitions: [
      mutation('operation.touch', 'touchOperation', [effect('update', 'Operation')]),
      mutation('host.open', 'openHost', [effect('create', 'Host')]),
    ],
    handlerLinks: [
      ...names.map((name) => handler('Job', name, { definitions: ['operation.touch'] })),
      handler('Job', 'open', { definitions: ['host.open'] }),
    ],
    integrations: [],
  }
  return value
}

/**
 * A Task nests under a parent Task (`subtaskOf`, a self relationship): `split` creates a Task with
 * its Edge to the parent, `nest` links two Tasks already there.
 */
export function selfBundle(): StudioSchemaBundle {
  const value = bundle({
    Task: withMethods(nodeClass('Task'), ['split', 'nest']),
    subtaskOf: edgeClass('subtaskOf', [
      endpoint('child', [local('Task')]),
      endpoint('parent', [local('Task')]),
    ]),
  })
  value.overlay = {
    sourceSpans: {},
    definitions: [
      mutation('task.split', 'splitTask', [
        effect('create', 'Task'),
        effect('create', 'subtaskOf', { verb: 'createEdge' }),
      ]),
      mutation('task.nest', 'nestTask', [effect('create', 'subtaskOf', { verb: 'createEdge' })]),
    ],
    handlerLinks: [
      handler('Task', 'split', { definitions: ['task.split'] }),
      handler('Task', 'nest', { definitions: ['task.nest'] }),
    ],
    integrations: [],
  }
  return value
}
