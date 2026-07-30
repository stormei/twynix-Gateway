import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { normalizeEdgeConfig } from '../config.js';
import { toOpcUaAlarmEvent } from '../opcua/OpcUaClient.js';
import {
  ThingsBoardAlarmEventPublisher,
  alarmType,
  mapAlarmSeverity,
  normalizeAlarmEvent
} from '../tb/ThingsBoardAlarmEventPublisher.js';
import type { EdgeConfig, NormalizedAlarmEvent, OpcUaAlarmEvent, TagSpec } from '../types.js';

type Published = { mapping: TagSpec; values: Record<string, unknown>; ts?: number };

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'twynix-alarm-events-'));
  const config = normalizeEdgeConfig({
    deviceName: 'Gateway A',
    tb: {
      url: 'mqtt://localhost:1883',
      accessToken: 'gateway-token',
      clientId: 'gateway-a',
      qos: 1,
      alarmEvents: {
        enabled: true,
        telemetryKey: 'twynix_opcua_alarm_event',
        statePath: path.join(directory, 'alarm-state.json'),
        severityMapping: {
          criticalMin: 900,
          majorMin: 800,
          warningMin: 600,
          minorMin: 300
        }
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
  const published: Published[] = [];
  const telemetry = {
    publish: async (mapping: TagSpec, values: Record<string, unknown>, ts?: number) => {
      published.push({ mapping, values, ts });
    }
  };
  return {
    config,
    directory,
    published,
    telemetry,
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

function eventAt(published: Published[], index: number): NormalizedAlarmEvent {
  return published[index].values.twynix_opcua_alarm_event as NormalizedAlarmEvent;
}

test('first active event publishes once and duplicate active events are suppressed', async () => {
  const f = await fixture();
  try {
    const publisher = new ThingsBoardAlarmEventPublisher(f.config, f.telemetry);
    await publisher.process(alarm());
    await publisher.process(alarm({ eventId: 'new-event-id', receiveTime: 1700000000200 }));

    assert.equal(f.published.length, 1);
    assert.equal(eventAt(f.published, 0).active, true);
    assert.equal(publisher.getDiagnostics().suppressed, 1);
  } finally {
    await f.close();
  }
});

test('severity change updates the same stable alarm identity', async () => {
  const f = await fixture();
  try {
    const publisher = new ThingsBoardAlarmEventPublisher(f.config, f.telemetry);
    await publisher.process(alarm());
    await publisher.process(alarm({ severity: 800, message: 'Temperature off-normal alarm' }));

    assert.equal(f.published.length, 2);
    assert.equal(eventAt(f.published, 0).alarmType, eventAt(f.published, 1).alarmType);
    assert.equal(eventAt(f.published, 1).thingsBoardSeverity, 'MAJOR');
  } finally {
    await f.close();
  }
});

test('inactive event clears the same alarm identity', async () => {
  const f = await fixture();
  try {
    const publisher = new ThingsBoardAlarmEventPublisher(f.config, f.telemetry);
    await publisher.process(alarm());
    await publisher.process(alarm({ active: false, retain: false, severity: 0, message: 'Back to normal' }));

    assert.equal(f.published.length, 2);
    assert.equal(eventAt(f.published, 0).alarmType, eventAt(f.published, 1).alarmType);
    assert.equal(eventAt(f.published, 1).active, false);
    assert.equal(publisher.getDiagnostics().trackedActiveCount, 0);
  } finally {
    await f.close();
  }
});

test('condition refresh after restart does not republish unchanged active alarms', async () => {
  const f = await fixture();
  try {
    const first = new ThingsBoardAlarmEventPublisher(f.config, f.telemetry);
    await first.process(alarm());
    const restarted = new ThingsBoardAlarmEventPublisher(f.config, f.telemetry);
    await restarted.reconcile([alarm({ eventId: 'refresh-event', receiveTime: 1700000000300 })]);

    assert.equal(f.published.length, 1);
    assert.equal(restarted.getDiagnostics().trackedActiveCount, 1);
  } finally {
    await f.close();
  }
});

test('condition refresh clears a persisted condition that is no longer active', async () => {
  const f = await fixture();
  try {
    const first = new ThingsBoardAlarmEventPublisher(f.config, f.telemetry);
    await first.process(alarm());
    const restarted = new ThingsBoardAlarmEventPublisher(f.config, f.telemetry);
    await restarted.reconcile([]);

    assert.equal(f.published.length, 2);
    assert.equal(eventAt(f.published, 1).active, false);
    assert.equal(eventAt(f.published, 1).status, 'Absent from OPC UA Condition Refresh');
  } finally {
    await f.close();
  }
});

test('different conditions on the same source have distinct alarm types', async () => {
  const f = await fixture();
  try {
    const first = alarm();
    const second = alarm({ conditionId: 'ns=1;s=A1.Temperature.WarningAlarm' });
    assert.notEqual(alarmType(first), alarmType(second));
  } finally {
    await f.close();
  }
});

test('mapped device is selected as ThingsBoard message originator', async () => {
  const f = await fixture();
  try {
    const normalized = normalizeAlarmEvent(alarm(), f.config);
    assert.equal(normalized.mapping.target?.mode, 'mapped-device');
    assert.equal(normalized.mapping.target?.thingsBoardDeviceName, 'Machine 1');
    assert.deepEqual(normalized.event.originator, {
      mode: 'mapped-device',
      deviceId: 'device-1',
      deviceName: 'Machine 1'
    });
  } finally {
    await f.close();
  }
});

test('gateway device is the fallback originator when source mapping is unavailable', async () => {
  const f = await fixture();
  try {
    const normalized = normalizeAlarmEvent(alarm({ sourceNode: 'ns=1;s=Unmapped' }), f.config);
    assert.equal(normalized.mapping.target?.mode, 'gateway-device');
    assert.deepEqual(normalized.event.originator, {
      mode: 'gateway-device',
      deviceName: 'Gateway A'
    });
  } finally {
    await f.close();
  }
});

test('malformed alarm events are rejected without publishing telemetry', async () => {
  const f = await fixture();
  try {
    const publisher = new ThingsBoardAlarmEventPublisher(f.config, f.telemetry);
    await assert.rejects(
      publisher.process({ ...alarm(), conditionId: '', sourceNode: '', active: 'yes' as any }),
      /active must be a boolean/
    );
    assert.equal(f.published.length, 0);
  } finally {
    await f.close();
  }
});

test('severity mapping uses configurable documented thresholds', async () => {
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
