import type {
  DomainAnatomy,
  IrClass,
  JsonSchema,
  StudioSchemaBundle,
} from '@shared/contracts/schema'
import type { IrClassRef } from '@shared/schema/identity'

export function nodeClass(name: string, input: Partial<IrClass> = {}): IrClass {
  return {
    type: 'node',
    name,
    origin: 'local.example.dev',
    ref: { origin: 'local.example.dev', kind: 'class', name },
    properties: {},
    methods: {},
    ...input,
  }
}

export function edgeClass(name: string, endpoints: IrClass['endpoints']): IrClass {
  return {
    type: 'edge',
    name,
    origin: 'local.example.dev',
    ref: { origin: 'local.example.dev', kind: 'class', name },
    properties: {},
    methods: {},
    endpoints,
  }
}

export function classRef(origin: string, name: string): IrClassRef {
  return { origin, kind: 'class', name }
}

/** The DSL's Node path value schema, accepting the named Classes. */
export function nodePath(...accepts: IrClassRef[]): JsonSchema {
  return {
    $ref: 'https://schemas.astrale.ai/graph/1/node-path',
    'x-astrale-path': { target: 'node', cardinality: 'one', accepts },
  }
}

export function bundle(
  classes: Record<string, IrClass>,
  input: Partial<StudioSchemaBundle> = {},
): StudioSchemaBundle {
  const domain = 'local.example.dev'
  return {
    domainId: 'local',
    renderFingerprint: 'fixture',
    schemaMode: 'canonical-admitted',
    extractedBy: 'runtime-bun',
    depsInstalled: true,
    ir: {
      version: 'v1',
      format: 'astrale.dsl',
      domain,
      classes,
      importsByKey: {},
      importedClassesByKey: {},
      functions: {},
      views: {},
      policies: {},
      dependencies: [],
      core: {},
    },
    overlay: {
      handlerLinks: [],
      sourceSpans: {},
    },
    extractedAt: '2026-08-23T00:00:00.000Z',
    ...input,
  }
}

/** Record `ref` as a dependency of `value`, optionally with the Class it resolved to. */
export function importClass(value: StudioSchemaBundle, ref: IrClassRef, resolved?: IrClass): void {
  const key = `${ref.origin}:class.${ref.name}` as const
  value.ir!.importsByKey[key] = { origin: ref.origin, ref, key }
  if (resolved) value.ir!.importedClassesByKey[key] = resolved
}

export function anatomy(
  views: DomainAnatomy['views'],
  origin = 'local.example.dev',
): DomainAnatomy {
  return {
    overview: { origin, adapter: 'astrale', requires: [], astraleDeps: {}, schemaDir: 'schema' },
    views,
    client: { routes: {}, shell: [], features: [], present: true },
    env: [],
    detectedIntegrations: [],
  }
}
