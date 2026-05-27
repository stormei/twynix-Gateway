import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEdgeConfig } from '../config.js';
import { RpcExecutor } from '../rpc/RpcExecutor.js';
import { EdgeConfig, TagSpec } from '../types.js';

function makeConfig(tag: any): EdgeConfig {
  return normalizeEdgeConfig({
    deviceName: 'gw',
    tb: { url: 'mqtt://localhost', accessToken: 'token', clientId: 'gw', qos: 1 },
    opcua: { url: 'opc.tcp://localhost:4840', subscribe: true, samplingMs: 250 },
    mapping: [tag],
    sqlitePath: './data/test.db',
    sqliteMaxRows: 1000,
    rpcJournalPath: './data/test-rpc.db',
    rpcJournalMaxRows: 1000,
    logLevel: 'error',
    writeMinIntervalMs: 0
  } as EdgeConfig);
}

class FakeOpc {
  writes: Array<{ tag: TagSpec; value: any }> = [];
  value: any;
  async write(tag: TagSpec, value: any) {
    this.writes.push({ tag, value });
    this.value = value;
    return { statusCode: 'Good' };
  }
  async read() {
    return this.value;
  }
}

test('RPC write success returns OK', async () => {
  const cfg = makeConfig({ key: 'Setpoint', nodeId: 'ns=2;s=SP', type: 'Double', writable: true });
  const opc = new FakeOpc();
  const rpc = new RpcExecutor(cfg, opc, cfg.mapping);

  const result = await rpc.handle({ method: 'writeTag', params: { key: 'Setpoint', value: 10 } });

  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
  assert.equal(opc.writes.length, 1);
});

test('RPC denied when write.enabled=false', async () => {
  const cfg = makeConfig({ key: 'PV', nodeId: 'ns=2;s=PV', type: 'Double', writable: false });
  const opc = new FakeOpc();
  const rpc = new RpcExecutor(cfg, opc, cfg.mapping);

  const result = await rpc.handle({ method: 'writeTag', params: { key: 'PV', value: 10 } });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'NOT_ALLOWED');
  assert.equal(opc.writes.length, 0);
});

test('RPC rejected on min/max violation', async () => {
  const cfg = makeConfig({ key: 'SP', nodeId: 'ns=2;s=SP', type: 'Double', writable: true, min: 0, max: 100 });
  const opc = new FakeOpc();
  const rpc = new RpcExecutor(cfg, opc, cfg.mapping);

  const result = await rpc.handle({ method: 'writeTag', params: { key: 'SP', value: 101 } });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'OUT_OF_RANGE');
  assert.equal(opc.writes.length, 0);
});

test('mapped-device RPC resolves method and target device', async () => {
  const cfg = makeConfig({
    key: 'PumpSpeed',
    nodeId: 'ns=2;s=PumpSpeed',
    type: 'Double',
    writable: true,
    target: { mode: 'mapped-device', thingsBoardDeviceName: 'Pump A', telemetryKey: 'speed' },
    write: { enabled: true, rpcMethod: 'setSpeed', min: 0, max: 100 }
  });
  const opc = new FakeOpc();
  const rpc = new RpcExecutor(cfg, opc, cfg.mapping);

  const result = await rpc.handleMappedDeviceRpc(
    { deviceName: 'Pump A' },
    { method: 'setSpeed', params: { value: 55 } }
  );

  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
  assert.equal(opc.writes[0].tag.key, 'PumpSpeed');
});
