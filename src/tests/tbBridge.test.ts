import test from 'node:test';
import assert from 'node:assert/strict';
import { TbBridge } from '../tb/TbBridge.js';
import { normalizeEdgeConfig } from '../config.js';
import { EdgeConfig } from '../types.js';
import { configApplyStatus, gatewayStatusTelemetry } from '../status.js';

class FakeMqtt {
  handlers = new Map<string, (topic: string, payload: Buffer) => void>();
  publishes: Array<{ topic: string; payload: string }> = [];
  subscribe(topic: string, handler: (topic: string, payload: Buffer) => void) {
    this.handlers.set(topic, handler);
  }
  async publish(topic: string, payload: string) {
    this.publishes.push({ topic, payload });
  }
  emit(topic: string, payload: any) {
    const handler = this.handlers.get('v1/devices/me/attributes');
    assert.ok(handler);
    handler(topic, Buffer.from(JSON.stringify(payload)));
  }
  emitRpc(reqId: string, payload: any) {
    const handler = this.handlers.get('v1/devices/me/rpc/request/+');
    assert.ok(handler);
    handler(`v1/devices/me/rpc/request/${reqId}`, Buffer.from(JSON.stringify(payload)));
  }
}

test('shared attributes desiredConfig applies config update', async () => {
  const cfg = normalizeEdgeConfig({
    deviceName: 'gw',
    tb: { url: 'mqtt://localhost', accessToken: 'token', clientId: 'gw', qos: 1 },
    opcua: { url: 'opc.tcp://localhost:4840', subscribe: true, samplingMs: 250 },
    mapping: [],
    sqlitePath: './data/tbBridge-test.db',
    sqliteMaxRows: 1000,
    rpcJournalPath: './data/tbBridge-rpc-test.db',
    rpcJournalMaxRows: 1000,
    logLevel: 'error',
    writeMinIntervalMs: 0
  } as EdgeConfig);
  const mqtt = new FakeMqtt();
  const patches: any[] = [];
  const bridge = new TbBridge(mqtt as any, cfg, new Map());

  bridge.start(async () => ({ ok: true }), async (patch) => {
    patches.push(patch);
    return configApplyStatus('APPLIED', patch.desiredVersion, cfg);
  });
  mqtt.emit('v1/devices/me/attributes', { 'edge.desiredConfig': { mapping: [{ key: 'PV' }] } });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].patch, { mapping: [{ key: 'PV' }] });
  assert.equal(patches[0].source, 'shared-update');
  const status = gatewayStatusTelemetry(cfg, 'ready', null, true);
  assert.equal(status.runtime_status, 'ready');
  assert.equal(status.mapping_count, 0);
  assert.equal(status.mapped_target_device_count, 0);
  assert.ok(status.applied_config_version);
  bridge.close();
});

test('shared attribute apply does not publish status from a closed bridge', async () => {
  const cfg = normalizeEdgeConfig({
    deviceName: 'gw',
    tb: { url: 'mqtt://localhost', accessToken: 'token', clientId: 'gw', qos: 1 },
    opcua: { url: 'opc.tcp://localhost:4840', subscribe: true, samplingMs: 250 },
    mapping: [],
    sqlitePath: './data/tbBridge-close-test.db',
    sqliteMaxRows: 1000,
    rpcJournalPath: './data/tbBridge-close-rpc-test.db',
    rpcJournalMaxRows: 1000,
    logLevel: 'error',
    writeMinIntervalMs: 0
  } as EdgeConfig);
  const mqtt = new FakeMqtt();
  const bridge = new TbBridge(mqtt as any, cfg, new Map());

  bridge.start(async () => ({ ok: true }), async (patch) => {
    bridge.close();
    return configApplyStatus('APPLIED', patch.desiredVersion, cfg);
  });
  mqtt.emit('v1/devices/me/attributes', { 'edge.desiredConfig': { mapping: [{ key: 'PV' }] } });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(mqtt.publishes.length, 0);
});

test('oversized RPC responses are compacted before publishing', async () => {
  const cfg = normalizeEdgeConfig({
    deviceName: 'gw',
    tb: { url: 'mqtt://localhost', accessToken: 'token', clientId: 'gw', qos: 1 },
    opcua: { url: 'opc.tcp://localhost:4840', subscribe: true, samplingMs: 250 },
    mapping: [],
    sqlitePath: './data/tbBridge-rpc-size-test.db',
    sqliteMaxRows: 1000,
    rpcJournalPath: './data/tbBridge-rpc-size-journal.db',
    rpcJournalMaxRows: 1000,
    logLevel: 'error',
    writeMinIntervalMs: 0
  } as EdgeConfig);
  const mqtt = new FakeMqtt();
  const bridge = new TbBridge(mqtt as any, cfg, new Map());

  bridge.start(async () => ({ ok: true, nodes: 'x'.repeat(70 * 1024) }), async (patch) => {
    return configApplyStatus('APPLIED', patch.desiredVersion, cfg);
  });
  mqtt.emitRpc('oversized-response', { method: 'opcuaBrowse', params: {} });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(mqtt.publishes.length, 1);
  const response = JSON.parse(mqtt.publishes[0].payload);
  assert.equal(response.ok, false);
  assert.equal(response.code, 'RPC_RESPONSE_TOO_LARGE');
  assert.ok(mqtt.publishes[0].payload.length < 1024);
  bridge.close();
});
