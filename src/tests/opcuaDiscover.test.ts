import test from 'node:test';
import assert from 'node:assert/strict';
import { OpcUaBrowseNode } from '../types.js';

async function discoverWithBrowse(
  browse: (nodeId: string) => Promise<OpcUaBrowseNode[]>,
  rootNodeId = 'RootFolder',
  opts?: { maxDepth?: number; maxNodes?: number; timeoutMs?: number }
) {
  const maxDepth = Math.max(0, Math.min(20, Number(opts?.maxDepth ?? 6)));
  const maxNodes = Math.max(1, Math.min(10000, Number(opts?.maxNodes ?? 1000)));
  const timeoutMs = Math.max(1000, Math.min(120000, Number(opts?.timeoutMs ?? 15000)));
  const startedAt = Date.now();
  const visited = new Set<string>();
  const variables: any[] = [];
  let scannedNodes = 0;
  let truncated = false;

  const walk = async (nodeId: string, depth: number, browsePath: string): Promise<void> => {
    if (truncated) return;
    if (Date.now() - startedAt > timeoutMs) {
      truncated = true;
      return;
    }
    if (depth > maxDepth || visited.has(nodeId)) return;
    visited.add(nodeId);

    const children = await browse(nodeId);
    for (const child of children) {
      if (scannedNodes >= maxNodes) {
        truncated = true;
        return;
      }
      scannedNodes += 1;
      const childName = child.displayName || child.browseName || child.nodeId;
      const childPath = browsePath ? `${browsePath}/${childName}` : childName;
      if (child.nodeClass === 'Variable' && !!child.dataType) {
        variables.push({
          nodeId: child.nodeId,
          browsePath: childPath,
          displayName: childName,
          dataType: child.dataType,
          writable: child.writable
        });
      }
      if (child.hasChildren && depth < maxDepth) {
        await walk(child.nodeId, depth + 1, childPath);
      }
    }
  };

  await walk(rootNodeId, 0, '');
  return { ok: true, rootNodeId, variables, truncated, scannedNodes, maxDepth, maxNodes };
}

test('recursive OPC UA discovery returns variables with browse paths', async () => {
  const tree = new Map<string, OpcUaBrowseNode[]>([
    ['RootFolder', [
      { nodeId: 'objects', browseName: 'Objects', displayName: 'Objects', nodeClass: 'Object', hasChildren: true }
    ]],
    ['objects', [
      { nodeId: 'pump', browseName: 'Pump1', displayName: 'Pump1', nodeClass: 'Object', hasChildren: true }
    ]],
    ['pump', [
      { nodeId: 'speed', browseName: 'SpeedPV', displayName: 'SpeedPV', nodeClass: 'Variable', hasChildren: false, dataType: 'Double', writable: false },
      { nodeId: 'folder', browseName: 'Nested', displayName: 'Nested', nodeClass: 'Object', hasChildren: true }
    ]],
    ['folder', [
      { nodeId: 'enable', browseName: 'Enable', displayName: 'Enable', nodeClass: 'Variable', hasChildren: false, dataType: 'Boolean', writable: true }
    ]]
  ]);

  const result = await discoverWithBrowse(async (nodeId) => tree.get(nodeId) || []);

  assert.equal(result.truncated, false);
  assert.deepEqual(result.variables.map((variable) => variable.browsePath), [
    'Objects/Pump1/SpeedPV',
    'Objects/Pump1/Nested/Enable'
  ]);
});

test('recursive OPC UA discovery truncates at maxNodes', async () => {
  const tree = new Map<string, OpcUaBrowseNode[]>([
    ['RootFolder', [
      { nodeId: 'a', browseName: 'A', displayName: 'A', nodeClass: 'Variable', hasChildren: false, dataType: 'Double' },
      { nodeId: 'b', browseName: 'B', displayName: 'B', nodeClass: 'Variable', hasChildren: false, dataType: 'Double' }
    ]]
  ]);

  const result = await discoverWithBrowse(async (nodeId) => tree.get(nodeId) || [], 'RootFolder', { maxNodes: 1 });

  assert.equal(result.truncated, true);
  assert.equal(result.variables.length, 1);
});
