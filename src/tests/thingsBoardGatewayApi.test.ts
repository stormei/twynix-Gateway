import test from 'node:test';
import assert from 'node:assert/strict';
import { ThingsBoardGatewayApi } from '../tb/ThingsBoardGatewayApi.js';
import { normalizeMapping } from '../mapping.js';

class FakeMqtt {
  published: Array<{ topic: string; payload: string }> = [];
  handlers = new Map<string, (topic: string, payload: Buffer) => void>();
  connectListeners: Array<() => void | Promise<void>> = [];

  async publish(topic: string, payload: string) {
    this.published.push({ topic, payload });
  }

  subscribe(topic: string, handler: (topic: string, payload: Buffer) => void) {
    this.handlers.set(topic, handler);
  }

  onConnect(listener: () => void | Promise<void>) {
    this.connectListeners.push(listener);
  }

  async emit(topic: string, payload: any) {
    const handler = this.handlers.get(topic);
    assert.ok(handler);
    await handler(topic, Buffer.from(JSON.stringify(payload)));
  }
}

test('connectMappedDevices publishes ThingsBoard Gateway API connect messages', async () => {
  const mqtt = new FakeMqtt();
  const api = new ThingsBoardGatewayApi(mqtt, [
    normalizeMapping({
      key: 'PV',
      nodeId: 'ns=2;s=PV',
      target: { mode: 'mapped-device', thingsBoardDeviceName: 'Pump A', telemetryKey: 'pv' }
    })
  ]);

  await api.connectMappedDevices();

  assert.equal(mqtt.published.length, 1);
  assert.equal(mqtt.published[0].topic, 'v1/gateway/connect');
  assert.deepEqual(JSON.parse(mqtt.published[0].payload), { device: 'Pump A' });
});

test('connectMappedDevices refuses to connect the gateway device as downstream device', async () => {
  const mqtt = new FakeMqtt();
  const api = new ThingsBoardGatewayApi(mqtt, [
    normalizeMapping({
      key: 'PV',
      nodeId: 'ns=2;s=PV',
      target: { mode: 'mapped-device', thingsBoardDeviceName: 'Machine02', telemetryKey: 'pv' }
    })
  ], 'Machine02');

  await api.connectMappedDevices();

  assert.equal(mqtt.published.length, 0);
});

test('gateway rpc handler routes downstream ThingsBoard RPC and replies on v1/gateway/rpc', async () => {
  const mqtt = new FakeMqtt();
  const api = new ThingsBoardGatewayApi(mqtt, [
    normalizeMapping({
      key: 'SP',
      nodeId: 'ns=2;s=SP',
      target: { mode: 'mapped-device', thingsBoardDeviceName: 'Pump A', telemetryKey: 'sp' },
      write: { enabled: true, rpcMethod: 'setSp' }
    })
  ]);

  api.startRpcHandlers(async (identity, reqId, req) => {
    assert.deepEqual(identity, { deviceName: 'Pump A' });
    assert.equal(reqId, '7');
    assert.deepEqual(req, { method: 'setSp', params: { value: 10 } });
    return { ok: true, code: 'OK' };
  });

  await mqtt.emit('v1/gateway/rpc', {
    device: 'Pump A',
    data: { id: 7, method: 'setSp', params: { value: 10 } }
  });

  assert.equal(mqtt.published.length, 1);
  assert.equal(mqtt.published[0].topic, 'v1/gateway/rpc');
  assert.deepEqual(JSON.parse(mqtt.published[0].payload), {
    device: 'Pump A',
    id: 7,
    data: { ok: true, code: 'OK' }
  });
});
