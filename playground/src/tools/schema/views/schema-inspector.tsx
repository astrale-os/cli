import { useWorkspace } from '@/hooks/use-workspace'
import { EdgeDetail } from '@/tools/schema/components/edge-detail'
import { NodeDetail } from '@/tools/schema/components/node-detail'

export function SchemaInspector() {
  const { schema, selection } = useWorkspace()
  if (!schema) return null

  if (selection?.type === 'schema-node') return <NodeDetail schema={schema} nodeId={selection.id} />
  if (selection?.type === 'schema-edge') return <EdgeDetail schema={schema} edgeId={selection.id} />
  return null
}
