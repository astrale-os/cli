/**
 * Compatibility facade for Studio's static anatomy extractors.
 *
 * Semantic ownership lives under `anatomy/`; existing consumers keep this
 * stable entrypoint.
 */
export { buildClientTree } from './anatomy/client-tree'
export { buildEnvFields } from './anatomy/env-fields'
export { findSchemaDefinition, type SchemaDefinitionLocation } from './anatomy/schema-definition'
export { buildViews } from './anatomy/views'
