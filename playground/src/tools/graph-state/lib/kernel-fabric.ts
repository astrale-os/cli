/**
 * Kernel Fabric Constants (mirror)
 *
 * Mirrors kernel/core/fabric.ts — the kernel's structural primitives.
 * Kept in sync manually; these values are foundational and change
 * only on major kernel redesigns.
 *
 * Source of truth: kernel/core/fabric.ts
 */

export const STRUCTURE_TYPE = {
  hasParent: 'has_parent',
  instanceOf: 'instance_of',
  from: 'from',
  to: 'to',
  symlink: 'symlink',
} as const

export const STRUCTURE_LABEL = {
  Node: 'Node',
  Edge: 'Edge',
  Class: 'Class',
} as const

export const DOMAIN_TYPE = {
  ofDomain: 'of_domain',
  implements: 'implements',
  extends: 'extends',
  methodOf: 'method_of',
} as const

export const DOMAIN_LABEL = {
  Interface: 'Interface',
  Method: 'Method',
  Domain: 'Domain',
  Root: 'Root',
} as const

export const AUTH_TYPE = {
  hasPerm: 'has_perm',
  excludedFrom: 'excluded_from',
  constrainedBy: 'constrained_by',
  extendsWith: 'extends_with',
} as const

export const HIDDEN_EDGE_TYPES = new Set<string>([STRUCTURE_TYPE.from, STRUCTURE_TYPE.to])

const ALL_TYPES = { ...STRUCTURE_TYPE, ...DOMAIN_TYPE, ...AUTH_TYPE } as const
export const KERNEL_EDGE_TYPES = new Set<string>(Object.values(ALL_TYPES))

export const DEFAULT_HIDDEN_CLASSES = new Set<string>(
  Object.values(ALL_TYPES).filter((t) => t !== STRUCTURE_TYPE.hasParent),
)

export const META_NODE_LABELS = new Set<string>([
  ...Object.values(STRUCTURE_LABEL),
  ...Object.values(DOMAIN_LABEL),
])
