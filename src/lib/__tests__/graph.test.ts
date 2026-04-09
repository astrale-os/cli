import { describe, expect, test } from 'bun:test'

import { classifyGraph, type GraphStatus } from '../graph'

type KernelInstance = { id: string; graphName: string; status: string }

describe('classifyGraph', () => {
  const managerGraph = 'astrale-manager'

  function makeMap(entries: [string, KernelInstance][]): Map<string, KernelInstance> {
    return new Map(entries)
  }

  test('classifies the manager graph', () => {
    const result = classifyGraph('astrale-manager', managerGraph, makeMap([]), true)
    expect(result).toBe('manager' as GraphStatus)
  })

  test('classifies manager graph even when manager is unreachable', () => {
    const result = classifyGraph('astrale-manager', managerGraph, makeMap([]), false)
    expect(result).toBe('manager' as GraphStatus)
  })

  test('classifies in-use graph when instance references it', () => {
    const instances = makeMap([
      ['sub-1-graph', { id: 'sub-1', graphName: 'sub-1-graph', status: 'ready' }],
    ])
    const result = classifyGraph('sub-1-graph', managerGraph, instances, true)
    expect(result).toBe('in-use' as GraphStatus)
  })

  test('classifies orphaned when no instance references it', () => {
    const instances = makeMap([
      ['sub-1-graph', { id: 'sub-1', graphName: 'sub-1-graph', status: 'ready' }],
    ])
    const result = classifyGraph('dangling-graph', managerGraph, instances, true)
    expect(result).toBe('orphaned' as GraphStatus)
  })

  test('classifies unknown when manager is not reachable', () => {
    const result = classifyGraph('some-graph', managerGraph, makeMap([]), false)
    expect(result).toBe('unknown' as GraphStatus)
  })

  test('manager graph takes priority over instance match', () => {
    // Edge case: what if an instance also has graphName === config.graphName?
    const instances = makeMap([
      ['astrale-manager', { id: 'mgr', graphName: 'astrale-manager', status: 'ready' }],
    ])
    const result = classifyGraph('astrale-manager', managerGraph, instances, true)
    expect(result).toBe('manager' as GraphStatus)
  })

  test('handles empty instance map with manager reachable', () => {
    const result = classifyGraph('some-graph', managerGraph, makeMap([]), true)
    expect(result).toBe('orphaned' as GraphStatus)
  })
})
