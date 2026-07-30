import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { normalizeEdgeConfig } from '../config.js';
import { toOpcUaAlarmEvent } from '../opcua/OpcUaClient.js';
import {
  ThingsBoardAlarmRestSync,
  alarmType,
  mapAlarmSeverity,
  normalizeAlarmEvent
} from '../tb/ThingsBoardAlarmRestSync.js';
import type { EdgeConfig, OpcUaAlarmEvent } from '../types.js';

type RestCall = { url: string; init?: RequestInit };

async function fixture(overrides: Record<string, unknown> = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'twynix-alarm-rest-'));
  const config = normalizeEdgeConfig({
    deviceName: 'Gateway A',
    tb: {
      url: 'mqtt://localhost:1883',
      accessToken: 'gateway-token',
      clientId: 'gateway-a',
      qos: 1,
      alarmApi: {
        enabled: true,
        restUrl: 'http://thingsboard:8080',
        authType: 'api-key',
        apiKey: 'alarm-api-key',
        jwtToken: '',
        requestTimeoutMs: 5000,
        defaultDeviceName: 'Gateway A',
        statePath: path.join(directory, 'alarm-state.json'),
        severityMapping: {
          criticalMin: 900,
          majorMin: 800,
          warningMin: 600,
          minorMin: 300
        },
        ...overrides
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
    sqlitePath: path.join(directory, 'messages.db'),
    sqliteMaxRows: 1000,
    rpcJournalPath: path.join(directory, 'rpc.db'),
    rpcJournalMaxRows: 1000,
    logLevel: 'error',
    writeMinIntervalMs: 0
  } as EdgeConfig);

  const calls: RestCall[] = [];
  let created = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/api/alarm') && init?.method === 'POST') {
      created += 1;
      return new Response(JSON.stringify({
        id: { entityType: 'ALARM', id: `alarm-${created}` },
        acknowledged: false,
        cleared: false
      }), { status: 200 });
    }
    if (/\/api\/alarm\/alarm-\d+\/clear$/.test(url) && init?.method === 'POST') {
      return new Response('', { status: 200 });
    }
    if (/\/api\/alarm\/alarm-\d+\/ack$/.test(url) && init?.method === 'POST') {
      return new Response('', { status: 200 });
    }
    if (url.includes('/api/tenant/devices?deviceName=')) {
      return new Response(JSON.stringify({
        id: { entityType: 'DEVICE', id: 'resolved-device' }
      }), { status: 200 });
    }
    throw new Error(`Unexpected request ${init?.method || 'GET'} ${url}`);
  };

  return {
    config,
    directory,
    calls,
    fetchImpl,
    close: () => fs.remove(directory)
  };
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
    receiveTime: 1700000000100,
    quality: 'Good',
    ...overrides
  };
}

function alarmPosts(calls: RestCall[]) {
  return calls.filter((call) => call.url.endsWith('/api/alarm') && call.init?.method === 'POST');
}

test('active OPC UA condition creates a native ThingsBoard alarm through REST once', async () => {
  const f = await fixture();
  try {
    const sync = new ThingsBoardAlarmRestSync(f.config, f.fetchImpl);
    await sync.process(alarm());
    await sync.process(alarm({ eventId: 'new-event-id', receiveTime: 1700000000200 }));

    assert.equal(alarmPosts(f.calls).length, 1);
    const request = alarmPosts(f.calls)[0];
    const payload = JSON.parse(String(request.init?.body));
    assert.deepEqual(payload.originator, { entityType: 'DEVICE', id: 'device-1' });
    assert.equal(payload.severity, 'CRITICAL');
    assert.equal(payload.details.conditionId, 'ns=1;s=A1.Temperature.Alarm');
    assert.equal(payload.details.managedBy, 'twynix-gateway');
    assert.equal(
      (request.init?.headers as Record<string, string>)['X-Authorization'],
      'ApiKey alarm-api-key'
    );
    assert.equal(sync.getDiagnostics().suppressed, 1);
  } finally {
    await f.close();
  }
});

test('meaningful severity update preserves the stable alarm type', async () => {
  const f = await fixture();
  try {
    const sync = new ThingsBoardAlarmRestSync(f.config, f.fetchImpl);
    await sync.process(alarm());
    await sync.process(alarm({ severity: 800, message: 'Temperature off-normal alarm' }));

    const posts = alarmPosts(f.calls);
    assert.equal(posts.length, 2);
    const first = JSON.parse(String(posts[0].init?.body));
    const second = JSON.parse(String(posts[1].init?.body));
    assert.equal(first.type, second.type);
    assert.equal(second.severity, 'MAJOR');
  } finally {
    await f.close();
  }
});

test('inactive OPC UA condition clears the created ThingsBoard alarm', async () => {
  const f = await fixture();
  try {
    const sync = new ThingsBoardAlarmRestSync(f.config, f.fetchImpl);
    await sync.process(alarm());
    await sync.process(alarm({ active: false, retain: false, severity: 0, message: 'Back to normal' }));

    assert.ok(f.calls.some((call) =>
      call.url === 'http://thingsboard:8080/api/alarm/alarm-1/clear' &&
      call.init?.method === 'POST'
    ));
    assert.equal(sync.getDiagnostics().trackedActiveCount, 0);
    assert.equal(sync.getDiagnostics().cleared, 1);
  } finally {
    await f.close();
  }
});

test('condition refresh after restart suppresses unchanged active conditions', async () => {
  const f = await fixture();
  try {
    const first = new ThingsBoardAlarmRestSync(f.config, f.fetchImpl);
    await first.process(alarm());
    const restarted = new ThingsBoardAlarmRestSync(f.config, f.fetchImpl);
    await restarted.reconcile([alarm({ eventId: 'refresh-event', receiveTime: 1700000000300 })]);

    assert.equal(alarmPosts(f.calls).length, 1);
    assert.equal(restarted.getDiagnostics().trackedActiveCount, 1);
  } finally {
    await f.close();
  }
});

test('condition refresh clears persisted conditions no longer active in OPC UA', async () => {
  const f = await fixture();
  try {
    const first = new ThingsBoardAlarmRestSync(f.config, f.fetchImpl);
    await first.process(alarm());
    const restarted = new ThingsBoardAlarmRestSync(f.config, f.fetchImpl);
    await restarted.reconcile([]);

    assert.ok(f.calls.some((call) => call.url.endsWith('/api/alarm/alarm-1/clear')));
    assert.equal(restarted.getDiagnostics().trackedActiveCount, 0);
  } finally {
    await f.close();
  }
});

test('different OPC UA conditions have distinct stable alarm types', async () => {
  const f = await fixture();
  try {
    assert.notEqual(
      alarmType(alarm()),
      alarmType(alarm({ conditionId: 'ns=1;s=A1.Temperature.WarningAlarm' }))
    );
  } finally {
    await f.close();
  }
});

test('mapped device ID is used as native alarm originator', async () => {
  const f = await fixture();
  try {
    const normalized = normalizeAlarmEvent(alarm(), f.config);
    assert.deepEqual(normalized.originator, {
      mode: 'mapped-device',
      deviceId: 'device-1',
      deviceName: 'Machine 1'
    });
  } finally {
    await f.close();
  }
});

test('unmapped source resolves the configured fallback device by name', async () => {
  const f = await fixture();
  try {
    const sync = new ThingsBoardAlarmRestSync(f.config, f.fetchImpl);
    await sync.process(alarm({ sourceNode: 'ns=1;s=Unmapped' }));

    assert.ok(f.calls.some((call) =>
      call.url.endsWith('/api/tenant/devices?deviceName=Gateway%20A')
    ));
    const payload = JSON.parse(String(alarmPosts(f.calls)[0].init?.body));
    assert.deepEqual(payload.originator, {
      entityType: 'DEVICE',
      id: 'resolved-device'
    });
  } finally {
    await f.close();
  }
});

test('JWT authentication remains available for ThingsBoard versions without API keys', async () => {
  const f = await fixture({
    authType: 'jwt',
    apiKey: '',
    jwtToken: 'legacy-jwt'
  });
  try {
    const sync = new ThingsBoardAlarmRestSync(f.config, f.fetchImpl);
    await sync.process(alarm());
    assert.equal(
      (alarmPosts(f.calls)[0].init?.headers as Record<string, string>)['X-Authorization'],
      'Bearer legacy-jwt'
    );
  } finally {
    await f.close();
  }
});

test('OPC UA acknowledgement acknowledges the native ThingsBoard alarm', async () => {
  const f = await fixture();
  try {
    const sync = new ThingsBoardAlarmRestSync(f.config, f.fetchImpl);
    await sync.process(alarm({ acknowledged: true }));
    assert.ok(f.calls.some((call) =>
      call.url.endsWith('/api/alarm/alarm-1/ack') &&
      call.init?.method === 'POST'
    ));
  } finally {
    await f.close();
  }
});

test('malformed alarm event is rejected before calling ThingsBoard', async () => {
  const f = await fixture();
  try {
    const sync = new ThingsBoardAlarmRestSync(f.config, f.fetchImpl);
    await assert.rejects(
      sync.process({ ...alarm(), conditionId: '', sourceNode: '', active: 'yes' as any }),
      /active must be a boolean/
    );
    assert.equal(f.calls.length, 0);
  } finally {
    await f.close();
  }
});

test('severity thresholds are configurable', async () => {
  const f = await fixture();
  try {
    assert.equal(mapAlarmSeverity(900, f.config), 'CRITICAL');
    assert.equal(mapAlarmSeverity(800, f.config), 'MAJOR');
    assert.equal(mapAlarmSeverity(600, f.config), 'WARNING');
    assert.equal(mapAlarmSeverity(300, f.config), 'MINOR');
    assert.equal(mapAlarmSeverity(0, f.config), 'INDETERMINATE');
  } finally {
    await f.close();
  }
});

test('node-opcua alarm fields normalize into a serializable event', () => {
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
      quality: { value: { toString: () => 'Good' } },
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
    time: 1700000000000,
    quality: 'Good',
    status: undefined
  });
});
