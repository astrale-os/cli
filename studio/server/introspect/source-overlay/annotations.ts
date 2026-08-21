/**
 * Compatibility owner for Studio schema annotations.
 *
 * The current Kernel admits enum updates against their exact Value Schema, so
 * there are no source-derived annotations today. The serialized overlay field
 * remains consumed by the client and shared contract.
 */
import type { SchemaAnnotation, SchemaIR } from '../../../shared/types'

export function buildSchemaAnnotations(_args: { ir: SchemaIR | null }): SchemaAnnotation[] {
  // The current Kernel admits updated values against their exact Value Schema;
  // enum properties therefore need no Studio-specific compatibility warning.
  return []
}
