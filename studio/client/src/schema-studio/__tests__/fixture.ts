import type { IrClass, IrClassRef, StudioSchemaBundle } from '@shared/types'

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
      version: '1',
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
      origin: domain,
      requires: [],
      crossDomainImports: [],
      mixins: [],
      handlerLinks: [],
      sourceSpans: {},
      annotations: [],
    },
    extractedAt: '2026-08-23T00:00:00.000Z',
    ...input,
  }
}
