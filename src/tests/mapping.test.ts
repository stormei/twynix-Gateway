import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEdgeConfig } from '../config.js';
import { mergeConfig, rejectInvalidMappedTargets } from '../runtime/GatewayRuntime.js';
import { TelemetryPublisher } from '../tb/TelemetryPublisher.js';
import { EdgeConfig } from '../types.js';

function baseConfig(mapping: any[]): EdgeConfig {
  return normalizeEdgeConfig({
    deviceName: 'gw',
    tb: {
      url: 'mqtt://localhost',
      accessToken: 'gateway-token',
      clientId: 'gw-client',
      qos: 1,
      deviceCredentials: [{ thingsBoardDeviceName: 'Pump A', accessToken: 'pump-token' }]
    },
    opcua: { url: 'opc.tcp://localhost:4840', subscribe: true, samplingMs: 250 },
    mapping,
    sqlitePath: './data/test.db',
    sqliteMaxRows: 1000,
    rpcJournalPath: './data/test-rpc.db',
    rpcJournalMaxRows: 1000,
    logLevel: 'error',
    writeMinIntervalMs: 0
  } as EdgeConfig);
}

class FakeMqtt {
  published: Array<{ topic: string; payload: string }> = [];
  async publish(topic: string, payload: string) {
    this.published.push({ topic, payload });
  }
}

test('legacy mapping loads with gateway-device defaults', () => {
  const cfg = baseConfig([
    { key: 'SpeedPV', nodeId: 'ns=2;s=SpeedPV', type: 'Double', writable: false }
  ]);

  assert.equal(cfg.mapping[0].target?.mode, 'gateway-device');
  assert.equal(cfg.mapping[0].target?.telemetryKey, 'SpeedPV');
  assert.equal(cfg.mapping[0].opcua?.nodeId, 'ns=2;s=SpeedPV');
  assert.equal(cfg.mapping[0].read?.enabled, true);
});

test('mapping with target device identity defaults to mapped-device mode', () => {
  const cfg = baseConfig([
    {
      key: 'TempRaw',
      nodeId: 'ns=2;s=Temp',
      type: 'Double',
      writable: false,
      target: { thingsBoardDeviceName: 'Pump A', telemetryKey: 'temperature' }
    }
  ]);

  assert.equal(cfg.mapping[0].target?.mode, 'mapped-device');
  assert.equal(cfg.mapping[0].target?.thingsBoardDeviceName, 'Pump A');
});

test('misplaced opcua.mappings loads as active top-level mappings', () => {
  const cfg = normalizeEdgeConfig({
    deviceName: 'gw',
    tb: {
      url: 'mqtt://localhost',
      accessToken: 'gateway-token',
      clientId: 'gw-client',
      qos: 1
    },
    opcua: {
      url: 'opc.tcp://localhost:4840',
      subscribe: true,
      samplingMs: 250,
      mappings: [{
        key: 'TempRaw',
        nodeId: 'ns=2;s=Temp',
        type: 'Double',
        writable: false,
        target: { mode: 'mapped-device', thingsBoardDeviceName: 'Pump A', telemetryKey: 'temperature' }
      }]
    },
    sqlitePath: './data/test.db',
    sqliteMaxRows: 1000,
    rpcJournalPath: './data/test-rpc.db',
    rpcJournalMaxRows: 1000,
    logLevel: 'error',
    writeMinIntervalMs: 0
  } as any);

  assert.equal(cfg.mapping.length, 1);
  assert.equal(cfg.mapping[0].key, 'TempRaw');
  assert.equal(cfg.mapping[0].target?.mode, 'mapped-device');
  assert.equal((cfg.opcua as any).mappings, undefined);
});

test('shared patch opcua.mappings replaces active mappings', () => {
  const current = baseConfig([
    { key: 'Old', nodeId: 'ns=2;s=Old', type: 'Double', writable: false }
  ]);
  const next = mergeConfig(current, {
    opcua: {
      mappings: [{
        key: 'TempRaw',
        nodeId: 'ns=2;s=Temp',
        type: 'Double',
        writable: false,
        target: { mode: 'mapped-device', thingsBoardDeviceName: 'Pump A', telemetryKey: 'temperature' }
      }]
    }
  });

  assert.equal(next.mapping.length, 1);
  assert.equal(next.mapping[0].key, 'TempRaw');
  assert.equal(next.mapping[0].target?.thingsBoardDeviceName, 'Pump A');
  assert.equal((next.opcua as any).mappings, undefined);
});

test('shared patch preserves existing mapped target when incoming target points at gateway device', () => {
  const current = baseConfig([
    {
      key: 'TempRaw',
      nodeId: 'ns=2;s=Temp',
      type: 'Double',
      writable: false,
      target: {
        mode: 'mapped-device',
        thingsBoardDeviceId: 'target-id',
        thingsBoardDeviceName: 'Pump A',
        telemetryKey: 'temperature'
      }
    }
  ]);
  const next = mergeConfig(current, {
    mapping: [{
      key: 'TempRaw',
      nodeId: 'ns=2;s=Temp',
      type: 'Double',
      writable: false,
      target: {
        mode: 'mapped-device',
        thingsBoardDeviceId: 'gateway-id',
        thingsBoardDeviceName: current.deviceName,
        telemetryKey: 'temperature'
      }
    }]
  });

  assert.equal(next.mapping[0].target?.mode, 'mapped-device');
  assert.equal(next.mapping[0].target?.thingsBoardDeviceId, 'target-id');
  assert.equal(next.mapping[0].target?.thingsBoardDeviceName, 'Pump A');
});

test('mapped-device target cannot point at gateway device', () => {
  const cfg = baseConfig([
    {
      key: 'TempRaw',
      nodeId: 'ns=2;s=Temp',
      type: 'Double',
      writable: false,
      target: { mode: 'mapped-device', thingsBoardDeviceName: 'gw', telemetryKey: 'temperature' }
    }
  ]);

  assert.throws(() => rejectInvalidMappedTargets(cfg), /Mapped-device target cannot be the gateway device gw: TempRaw/);
});

test('opcua.mappings wins over stale top-level mapping during migration', () => {
  const cfg = normalizeEdgeConfig({
    deviceName: 'gw',
    tb: {
      url: 'mqtt://localhost',
      accessToken: 'gateway-token',
      clientId: 'gw-client',
      qos: 1
    },
    opcua: {
      url: 'opc.tcp://localhost:4840',
      subscribe: true,
      samplingMs: 250,
      mappings: [{
        key: 'NewTemp',
        nodeId: 'ns=2;s=NewTemp',
        type: 'Double',
        writable: false,
        target: { mode: 'mapped-device', thingsBoardDeviceName: 'Pump A', telemetryKey: 'temperature' }
      }]
    },
    mapping: [{ key: 'Old', nodeId: 'ns=2;s=Old', type: 'Double', writable: false }],
    sqlitePath: './data/test.db',
    sqliteMaxRows: 1000,
    rpcJournalPath: './data/test-rpc.db',
    rpcJournalMaxRows: 1000,
    logLevel: 'error',
    writeMinIntervalMs: 0
  } as any);

  assert.equal(cfg.mapping.length, 1);
  assert.equal(cfg.mapping[0].key, 'NewTemp');
  assert.equal((cfg.opcua as any).mappings, undefined);
});

test('gateway-device telemetry publish uses gateway MQTT session', async () => {
  const cfg = baseConfig([
    { key: 'SpeedPV', nodeId: 'ns=2;s=SpeedPV', type: 'Double', writable: false }
  ]);
  const gateway = new FakeMqtt();
  const target = new FakeMqtt();
  const publisher = new TelemetryPublisher(gateway as any, {
    getSessionForMapping: () => ({ mqtt: target })
  } as any);

  await publisher.publish(cfg.mapping[0], { SpeedPV: 42 }, 123);

  assert.equal(gateway.published.length, 1);
  assert.equal(target.published.length, 0);
  assert.deepEqual(JSON.parse(gateway.published[0].payload), { ts: 123, values: { SpeedPV: 42 } });
});

test('mapped-device telemetry publish uses target MQTT session', async () => {
  const cfg = baseConfig([
    {
      key: 'TempRaw',
      nodeId: 'ns=2;s=Temp',
      type: 'Double',
      writable: false,
      target: { mode: 'mapped-device', thingsBoardDeviceName: 'Pump A', telemetryKey: 'temperature' }
    }
  ]);
  const gateway = new FakeMqtt();
  const target = new FakeMqtt();
  const publisher = new TelemetryPublisher(gateway as any, {
    getSessionForMapping: () => ({ mqtt: target })
  } as any, undefined, 'device-sessions');

  await publisher.publish(cfg.mapping[0], { TempRaw: 19.5 }, 456);

  assert.equal(gateway.published.length, 0);
  assert.equal(target.published.length, 1);
  assert.deepEqual(JSON.parse(target.published[0].payload), { ts: 456, values: { temperature: 19.5 } });
});

test('mapped-device telemetry publish prefers ThingsBoard Gateway API when device name is present', async () => {
  const cfg = baseConfig([
    {
      key: 'TempRaw',
      nodeId: 'ns=2;s=Temp',
      type: 'Double',
      writable: false,
      target: { mode: 'mapped-device', thingsBoardDeviceName: 'Pump A', telemetryKey: 'temperature' }
    }
  ]);
  const gateway = new FakeMqtt();
  const target = new FakeMqtt();
  const gatewayApi = {
    canPublishMapping: () => true,
    publishTelemetry: async (_mapping: any, values: Record<string, any>, ts: number) => {
      await gateway.publish('v1/gateway/telemetry', JSON.stringify({ 'Pump A': [{ ts, values }] }));
    }
  };
  const publisher = new TelemetryPublisher(gateway as any, {
    getSessionForMapping: () => ({ mqtt: target })
  } as any, gatewayApi);

  await publisher.publish(cfg.mapping[0], { TempRaw: 19.5 }, 456);

  assert.equal(target.published.length, 0);
  assert.equal(gateway.published.length, 1);
  assert.equal(gateway.published[0].topic, 'v1/gateway/telemetry');
  assert.deepEqual(JSON.parse(gateway.published[0].payload), {
    'Pump A': [{ ts: 456, values: { temperature: 19.5 } }]
  });
});

test('mapped-device telemetry in gateway-api mode does not fall back to missing device sessions', async () => {
  const cfg = baseConfig([
    {
      key: 'TempRaw',
      nodeId: 'ns=2;s=Temp',
      type: 'Double',
      writable: false,
      target: { mode: 'mapped-device', thingsBoardDeviceName: 'Machine02', telemetryKey: 'temperature' }
    }
  ]);
  const gateway = new FakeMqtt();
  const target = new FakeMqtt();
  const gatewayApi = {
    canPublishMapping: () => false,
    publishTelemetry: async () => {
      throw new Error('should not publish');
    }
  };
  const publisher = new TelemetryPublisher(gateway as any, {
    getSessionForMapping: () => ({ mqtt: target })
  } as any, gatewayApi, 'gateway-api');

  await publisher.publish(cfg.mapping[0], { TempRaw: 19.5 }, 456);

  assert.equal(gateway.published.length, 0);
  assert.equal(target.published.length, 0);
});
