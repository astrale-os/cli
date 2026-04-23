/**
 * Self-contained operation catalog.
 *
 * Mirrors kernel-api/namespaces definitions without importing them directly
 * (kernel-core has broken exports that block the bundler). When kernel-core
 * is fixed, this can be replaced with a direct import from @astrale-os/kernel-api.
 */

export interface ParamField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'enum' | 'nodeRef'
  required: boolean
  description?: string
  default?: unknown
  enumValues?: string[]
  properties?: ParamField[]
  items?: ParamField
  /** For nodeRef type: the class name referenced (e.g. "Node") */
  nodeRefClass?: string
}

export interface OpEntry {
  namespace: string
  key: string
  wireName: string
  description: string
  params: ParamField[]
  isStatic?: boolean
  /** When set, the op cannot be invoked and the form shows `disabledReason`. */
  disabled?: boolean
  disabledReason?: string
}

// ─── Core (module.*) ─────────────────────────────────────────────────────────

const coreOps: OpEntry[] = [
  {
    namespace: 'core',
    key: 'openModule',
    wireName: 'module.open',
    description: 'Open a module by ID and retrieve its data.',
    params: [{ name: 'moduleId', type: 'string', required: true }],
  },
  {
    namespace: 'core',
    key: 'editModule',
    wireName: 'module.edit',
    description: 'Edit module metadata, storage, or type.',
    params: [
      { name: 'moduleId', type: 'string', required: true },
      { name: 'metadata', type: 'object', required: false, description: 'name, contentType, etc.' },
      { name: 'storage', type: 'boolean', required: false },
      { name: 'typeId', type: 'string', required: false },
    ],
  },
  {
    namespace: 'core',
    key: 'exploreModule',
    wireName: 'module.explore',
    description: 'Run a TypeGraph query AST against a module subtree.',
    params: [
      { name: 'rootId', type: 'string', required: true },
      { name: 'ast', type: 'object', required: true, description: 'TypeGraph query AST' },
    ],
  },
  {
    namespace: 'core',
    key: 'createModule',
    wireName: 'module.create',
    description: 'Create a new child module under a parent.',
    params: [
      { name: 'parentId', type: 'string', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'typeId', type: 'string', required: true },
    ],
  },
  {
    namespace: 'core',
    key: 'deleteModule',
    wireName: 'module.delete',
    description: 'Delete a module by ID.',
    params: [{ name: 'moduleId', type: 'string', required: true }],
  },
  {
    namespace: 'core',
    key: 'linkModule',
    wireName: 'module.link',
    description: 'Link or unlink two modules with a typed edge.',
    params: [
      { name: 'sourceId', type: 'string', required: true },
      { name: 'targetId', type: 'string', required: true },
      { name: 'typeId', type: 'string', required: true },
      { name: 'action', type: 'string', required: true, description: '"link" or "unlink"' },
      { name: 'metadata', type: 'object', required: false },
      { name: 'onConflict', type: 'string', required: false, description: '"patch" or "replace"' },
    ],
  },
  {
    namespace: 'core',
    key: 'linkedModules',
    wireName: 'module.linked',
    description: 'List modules linked to a source via a typed edge.',
    params: [
      { name: 'sourceId', type: 'string', required: true },
      { name: 'typeId', type: 'string', required: false },
      {
        name: 'direction',
        type: 'string',
        required: false,
        description: '"out" (default) or "in"',
      },
    ],
  },
  {
    namespace: 'core',
    key: 'resolveAppContext',
    wireName: 'app.resolveContext',
    description: 'Resolve the current application context (types + appdata tree).',
    params: [],
  },
]

// ─── Identity ────────────────────────────────────────────────────────────────

const identityOps: OpEntry[] = [
  {
    namespace: 'identity',
    key: 'findIdentity',
    wireName: 'identity.find',
    description: 'Find an identity by issuer and subject.',
    params: [
      { name: 'iss', type: 'string', required: true },
      { name: 'sub', type: 'string', required: true },
    ],
  },
  {
    namespace: 'identity',
    key: 'registerIdentity',
    wireName: 'identity.register',
    description: 'Register a new identity with a JWK and token.',
    params: [
      { name: 'jwks', type: 'object', required: true, description: 'JWK public key' },
      { name: 'token', type: 'string', required: true },
      { name: 'typeId', type: 'string', required: false },
    ],
  },
  {
    namespace: 'identity',
    key: 'provisionIdentity',
    wireName: 'identity.provision',
    description: 'Provision a new identity for future registration.',
    params: [
      { name: 'iss', type: 'string', required: true },
      { name: 'sub', type: 'string', required: true },
      { name: 'jwks', type: 'string', required: false },
      { name: 'requiredClaims', type: 'object', required: true },
    ],
  },
  {
    namespace: 'identity',
    key: 'bindIdentity',
    wireName: 'identity.bind',
    description: 'Bind an identity to a type.',
    params: [
      { name: 'identityId', type: 'string', required: true },
      { name: 'typeId', type: 'string', required: true },
    ],
  },
  {
    namespace: 'identity',
    key: 'grantAccess',
    wireName: 'identity.grantAccess',
    description: 'Grant permissions to an identity on a node.',
    params: [
      { name: 'identityId', type: 'string', required: true },
      { name: 'nodeId', type: 'string', required: true },
      {
        name: 'permissions',
        type: 'array',
        required: true,
        description: 'Array of permission strings',
      },
    ],
  },
  {
    namespace: 'identity',
    key: 'revokeAccess',
    wireName: 'identity.revokeAccess',
    description: 'Revoke permissions from an identity on a node.',
    params: [
      { name: 'identityId', type: 'string', required: true },
      { name: 'nodeId', type: 'string', required: true },
      { name: 'permissions', type: 'array', required: false },
    ],
  },
  {
    namespace: 'identity',
    key: 'mintDelegation',
    wireName: 'identity.mintDelegation',
    description: 'Mint a delegation token for an identity expression.',
    params: [
      { name: 'expression', type: 'object', required: true },
      { name: 'scopes', type: 'array', required: true },
      { name: 'ttl', type: 'number', required: false },
    ],
  },
  {
    namespace: 'identity',
    key: 'mintAttestation',
    wireName: 'identity.mintAttestation',
    description: 'Mint an attestation token.',
    params: [
      { name: 'scopes', type: 'array', required: true },
      { name: 'ttl', type: 'number', required: false },
    ],
  },
  {
    namespace: 'identity',
    key: 'checkAccess',
    wireName: 'identity.checkAccess',
    description: 'Check if a principal has access to a node with a permission.',
    params: [
      { name: 'principal', type: 'string', required: true },
      { name: 'nodeId', type: 'string', required: true },
      { name: 'perm', type: 'string', required: true },
      { name: 'token', type: 'string', required: true },
    ],
  },
]

// ─── Spaces ──────────────────────────────────────────────────────────────────

const spaceOps: OpEntry[] = [
  {
    namespace: 'spaces',
    key: 'create',
    wireName: 'spaces.create',
    description: 'Create a new space with a master identity.',
    params: [
      { name: 'name', type: 'string', required: true },
      { name: 'master', type: 'object', required: true, description: '{ jwks, token }' },
    ],
  },
  {
    namespace: 'spaces',
    key: 'patchConfig',
    wireName: 'spaces.patchConfig',
    description: 'Update space configuration.',
    params: [
      { name: 'datastoreUrl', type: 'string', required: true },
      { name: 'adminUrl', type: 'string', required: true },
    ],
  },
  {
    namespace: 'spaces',
    key: 'getConfig',
    wireName: 'spaces.getConfig',
    description: 'Get current space configuration.',
    params: [],
  },
]

// ─── Operations meta ─────────────────────────────────────────────────────────

const operationOps: OpEntry[] = [
  {
    namespace: 'operations',
    key: 'register',
    wireName: 'operations.register',
    description: 'Register a new operation with the kernel.',
    params: [
      { name: 'name', type: 'string', required: true },
      { name: 'description', type: 'string', required: false },
      {
        name: 'paramsSchema',
        type: 'object',
        required: true,
        description: 'JSON Schema for params',
      },
      {
        name: 'resultSchema',
        type: 'object',
        required: true,
        description: 'JSON Schema for result',
      },
      {
        name: 'authRequirement',
        type: 'string',
        required: true,
        description: '"any"|"shell"|"backend"|"system"',
      },
      { name: 'code', type: 'object', required: true, description: 'Operation code handlers' },
    ],
  },
  {
    namespace: 'operations',
    key: 'list',
    wireName: 'operations.list',
    description: 'List all registered operations.',
    params: [],
  },
]

// ─── Registry ────────────────────────────────────────────────────────────────

const ALL_OPS: OpEntry[] = [...coreOps, ...identityOps, ...spaceOps, ...operationOps]

export function getOpsByNamespace(): Record<string, OpEntry[]> {
  return groupByNamespace(ALL_OPS)
}

function groupByNamespace(ops: OpEntry[]): Record<string, OpEntry[]> {
  const grouped: Record<string, OpEntry[]> = {}
  for (const op of ops) {
    if (!grouped[op.namespace]) grouped[op.namespace] = []
    grouped[op.namespace].push(op)
  }
  return grouped
}

// ─── Dynamic loading from kernel ────────────────────────────────────────────

interface KernelOpInfo {
  name: string
  description?: string
  paramsSchema?: Record<string, unknown>
  resultSchema?: Record<string, unknown>
  authRequirement?: string
  syscall?: boolean
}

function jsonSchemaToParams(schema?: Record<string, unknown>): ParamField[] {
  if (!schema) return []

  let properties: Record<string, Record<string, unknown>>
  let required: string[]

  if (schema.type === 'object' && schema.properties) {
    properties = schema.properties as Record<string, Record<string, unknown>>
    required = (schema.required ?? []) as string[]
  } else if (!schema.type) {
    // Flat kernel schema: { paramName: { $nodeRef: "Class" } | ... }
    properties = schema as Record<string, Record<string, unknown>>
    required = []
  } else {
    return []
  }

  return Object.entries(properties).map(([name, prop]) => {
    if (prop.$nodeRef) {
      return {
        name,
        type: 'nodeRef' as const,
        required: required.includes(name),
        description: `${prop.$nodeRef} reference`,
        nodeRefClass: prop.$nodeRef as string,
      }
    }

    const field: ParamField = {
      name,
      type: (prop.type as ParamField['type']) ?? 'object',
      required: required.includes(name),
      description: prop.description as string | undefined,
      default: prop.default,
    }
    if (prop.enum) {
      field.type = 'enum'
      field.enumValues = prop.enum as string[]
    }
    if (prop.type === 'object' && prop.properties) {
      field.properties = jsonSchemaToParams(prop as Record<string, unknown>)
    }
    if (prop.type === 'array' && prop.items) {
      const itemSchema = prop.items as Record<string, unknown>
      field.items = {
        name: 'item',
        type: (itemSchema.type as ParamField['type']) ?? 'string',
        required: false,
        description: itemSchema.description as string | undefined,
      }
    }
    return field
  })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function isMethodOp(wireName: string): boolean {
  if (wireName.startsWith('/')) return false
  const dot = wireName.indexOf('.')
  return dot > 0 && /^[A-Z]/.test(wireName)
}

export function getMethodType(wireName: string): string | null {
  if (!isMethodOp(wireName)) return null
  return wireName.slice(0, wireName.indexOf('.'))
}

export function buildDefaults(params: ParamField[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const p of params) {
    if (p.default !== undefined) {
      values[p.name] = p.default
    } else if (p.type === 'boolean') {
      values[p.name] = false
    } else if (p.type === 'enum' && p.enumValues?.length) {
      values[p.name] = p.enumValues[0]
    } else if (p.type === 'object' && p.properties) {
      values[p.name] = buildDefaults(p.properties)
    } else if (p.type === 'array') {
      values[p.name] = []
    } else if (p.type === 'nodeRef') {
      values[p.name] = ''
    } else {
      values[p.name] = ''
    }
  }
  return values
}

export function parseOperationsList(operations: KernelOpInfo[]): Record<string, OpEntry[]> {
  const entries: OpEntry[] = operations.map((op) => {
    const dotIndex = op.name.indexOf('.')
    const namespace = dotIndex > 0 ? op.name.substring(0, dotIndex) : 'other'
    return {
      namespace,
      key: op.name,
      wireName: op.name,
      description: op.description ?? '',
      params: jsonSchemaToParams(op.paramsSchema),
    }
  })
  return groupByNamespace(entries)
}
