import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEdgeConfig } from '../config.js';
import { toOpcUaAlarmEvent } from '../opcua/OpcUaClient.js';
import { ThingsBoardAlarmSync, alarmSeverity, alarmType } from '../tb/ThingsBoardAlarmSync.js';
import type { EdgeConfig, OpcUaAlarmEvent } from '../types.js';

function cfg(): EdgeConfig {
  return normalizeEdgeConfig({
    deviceName: 'Gateway A',
    tb: {
      url: 'mqtt://localhost:1883',
      accessToken: 'gateway-token',
      clientId: 'gateway-a',
      qos: 1,
      alarmApi: {
        enabled: true,
        restUrl: 'http://thingsboard:8080',
        apiKey: 'alarm-api-key',
        requestTimeoutMs: 5000,
        defaultDeviceName: 'Gateway A'
      }
    },
    opcua: {
      url: 'opc.tcp://localhost:4840',
      subscribe: true,
      samplingMs: 250,
      alarms: { enabled: true }
    },
    mapping: [{
      key: 'Temperature',
      nodeId: 'ns=1;s=A1.Temperature',
      type: 'Double',
      writable: false,
      target: {
        mode: 'mapped-device',
        thingsBoardDeviceId: 'device-1',
        thingsBoardDeviceName: 'Machine 1',
        telemetryKey: 'temperature'
      }
    }],
    sqlitePath: './data/alarm-sync-test.db',
    sqliteMaxRows: 1000,
    rpcJournalPath: './data/alarm-sync-rpc-test.db',
    rpcJournalMaxRows: 1000,
    logLevel: 'error',
    writeMinIntervalMs: 0
  } as EdgeConfig);
}

function alarm(overrides: Partial<OpcUaAlarmEvent> = {}): OpcUaAlarmEvent {
  return {
    conditionId: 'ns=1;s=A1.Temperature.Alarm',
    eventId: 'aabbcc',
    eventType: 'ns=0;i=9341',
    sourceNode: 'ns=1;s=A1.Temperature',
    sourceName: 'Temperature',
    conditionName: 'Temperature limit alarm',
    message: 'Temperature HighHigh alarm',
    severity: 900,
    active: true,
    acknowledged: false,
    retain: true,
    state: 'HighHigh',
    time: 1700000000000,
    ...overrides
  };
}

test('OPC UA alarm creates and clears a ThingsBoard alarm through REST', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/api/alarm') && init?.method === 'POST') {
      return new Response(JSON.stringify({
        id: { entityType: 'ALARM', id: 'alarm-1' },
        acknowledged: false,
        cleared: false
      }), { status: 200 });
    }
    if (url.endsWith('/api/alarm/alarm-1/clear')) return new Response('', { status: 200 });
    throw new Error(`Unexpected request ${init?.method || 'GET'} ${url}`);
  };
  const sync = new ThingsBoardAlarmSync(cfg(), fakeFetch);

  await sync.process(alarm());
  await sync.process(alarm({ active: false, retain: false, severity: 0, state: undefined }));

  assert.equal(calls.length, 2);
  const createPayload = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual(createPayload.originator, { entityType: 'DEVICE', id: 'device-1' });
  assert.equal(createPayload.severity, 'CRITICAL');
  assert.equal(createPayload.details.conditionId, 'ns=1;s=A1.Temperature.Alarm');
  assert.equal(calls[0].init?.headers && (calls[0].init.headers as Record<string, string>)['X-Authorization'], 'ApiKey alarm-api-key');
  assert.equal(calls[1].url, 'http://thingsboard:8080/api/alarm/alarm-1/clear');
});

test('ThingsBoard acknowledgement is propagated back to OPC UA', async () => {
  const acknowledgements: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/alarm') && init?.method === 'POST') {
      return new Response(JSON.stringify({
        id: { entityType: 'ALARM', id: 'alarm-2' },
        acknowledged: false
      }), { status: 200 });
    }
    if (url.endsWith('/api/alarm/alarm-2')) {
      return new Response(JSON.stringify({ acknowledged: true }), { status: 200 });
    }
    throw new Error(`Unexpected request ${init?.method || 'GET'} ${url}`);
  };
  const sync = new ThingsBoardAlarmSync(cfg(), fakeFetch, async (conditionId) => {
    acknowledgements.push(conditionId);
  });

  await sync.process(alarm());
  await sync.pollAcknowledgements();

  assert.deepEqual(acknowledgements, ['ns=1;s=A1.Temperature.Alarm']);
});

test('alarm severity and type preserve OPC UA condition identity', () => {
  assert.equal(alarmSeverity(900), 'CRITICAL');
  assert.equal(alarmSeverity(800), 'MAJOR');
  assert.equal(alarmSeverity(600), 'WARNING');
  assert.match(alarmType(alarm()), /Temperature limit alarm/);
  assert.match(alarmType(alarm()), /A1\.Temperature\.Alarm/);
});

test('node-opcua client alarm fields normalize into a serializable event', () => {
  const clientAlarm = {
    conditionId: { toString: () => 'ns=1;s=Condition' },
    eventType: { toString: () => 'ns=0;i=9341' },
    eventId: Buffer.from('abcd', 'hex'),
    fields: {
      sourceNode: { value: { toString: () => 'ns=1;s=Temperature' } },
      sourceName: { value: 'Temperature' },
      conditionName: { value: 'High temperature' },
      message: { value: { text: 'Too hot' } },
      severity: { value: 900 },
      activeState: { value: { text: 'Active' }, id: { value: true } },
      ackedState: { value: { text: 'Unacknowledged' }, id: { value: false } },
      retain: { value: true },
      time: { value: new Date(1700000000000) }
    }
  };

  assert.deepEqual(toOpcUaAlarmEvent(clientAlarm as any), {
    conditionId: 'ns=1;s=Condition',
    eventId: 'abcd',
    eventType: 'ns=0;i=9341',
    sourceNode: 'ns=1;s=Temperature',
    sourceName: 'Temperature',
    conditionName: 'High temperature',
    message: 'Too hot',
    severity: 900,
    active: true,
    acknowledged: false,
    retain: true,
    state: 'Active',
    branchId: undefined,
    time: 1700000000000
  });
});
