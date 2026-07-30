import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEdgeConfig } from '../config.js';
import { configRestartScope } from '../runtimeConfig.js';
import { gatewayIdentityAttributes } from '../status.js';
import { EdgeConfig } from '../types.js';

function cfg(overrides: Partial<EdgeConfig> = {}): EdgeConfig {
  return normalizeEdgeConfig({
    deviceName: 'gw',
    tb: {
      url: 'mqtt://localhost',
      accessToken: 'secret-token',
      clientId: 'gw-client',
      qos: 1,
      mappedDeviceTransport: 'gateway-api',
      deviceCredentials: [{ thingsBoardDeviceName: 'Pump A', accessToken: 'target-secret' }],
      alarmApi: {
        enabled: false,
        restUrl: 'https://thingsboard.example',
        authType: 'api-key',
        apiKey: 'alarm-secret'
      }
    },
    opcua: {
      url: 'opc.tcp://localhost:4840',
      username: 'opc-user',
      password: 'opc-secret',
      subscribe: true,
      samplingMs: 250
    },
    mapping: [],
    sqlitePath: './data/hardening-test.db',
    sqliteMaxRows: 1000,
    mqttFlushBatchSize: 200,
    mqttFlushDelayMs: 0,
    mqttFlushIntervalMs: 15000,
    rpcJournalPath: './data/hardening-rpc-test.db',
    rpcJournalMaxRows: 1000,
    logLevel: 'error',
    writeMinIntervalMs: 0,
    ...overrides
  } as EdgeConfig);
}

test('gateway identity attributes publish sanitized config summary without secrets', () => {
  const attrs = gatewayIdentityAttributes(cfg());
  const text = JSON.stringify(attrs);

  assert.equal(attrs['edge.isGateway'], true);
  assert.equal(attrs.edge.config.tb.deviceCredentialCount, 1);
  assert.equal(attrs.edge.config.opcua.usernameConfigured, true);
  assert.equal(text.includes('secret-token'), false);
  assert.equal(text.includes('target-secret'), false);
  assert.equal(text.includes('opc-secret'), false);
  assert.equal(text.includes('alarm-secret'), false);
  assert.equal(attrs.edge.config.tb.alarmTransport, 'thingsboard-alarm-rest-api');
  assert.equal(attrs.edge.config.mqttFlushBatchSize, 200);
});

test('rule-chain alarm config migrates to disabled direct REST settings without inventing credentials', () => {
  const current = cfg();
  const migrated = cfg({
    tb: {
      ...current.tb,
      alarmApi: undefined,
      alarmEvents: {
        enabled: true,
        telemetryKey: 'twynix_opcua_alarm_event',
        severityMapping: {
          criticalMin: 950,
          majorMin: 850,
          warningMin: 650,
          minorMin: 350
        }
      }
    } as any
  });

  assert.equal(migrated.tb.alarmApi?.enabled, false);
  assert.equal(migrated.tb.alarmApi?.severityMapping?.criticalMin, 950);
  assert.equal(migrated.tb.alarmApi?.apiKey, '');
  assert.equal('alarmEvents' in migrated.tb, false);
});

test('config restart scope hot-applies mapping and write interval changes only', () => {
  const current = cfg();
  const next = cfg({
    mapping: [{
      key: 'PV',
      nodeId: 'ns=2;s=PV',
      type: 'Double',
      writable: false,
      target: { mode: 'gateway-device', telemetryKey: 'PV' },
      read: { enabled: true, mode: 'subscription' },
      opcua: { endpointId: 'default', nodeId: 'ns=2;s=PV', dataType: 'Double', writable: false }
    }],
    writeMinIntervalMs: 50
  });

  assert.equal(configRestartScope(current, next), 'hot');
});

test('config restart scope requires full restart for OPC UA endpoint changes', () => {
  const current = cfg();
  const next = cfg({
    opcua: {
      ...current.opcua,
      url: 'opc.tcp://localhost:49320'
    }
  });

  assert.equal(configRestartScope(current, next), 'full');
});

test('config restart scope requires full restart for MQTT flush throttle changes', () => {
  const current = cfg();
  const next = cfg({
    mqttFlushBatchSize: 50,
    mqttFlushDelayMs: 250
  });

  assert.equal(configRestartScope(current, next), 'full');
});

test('config restart scope ignores desired config version metadata', () => {
  const current = cfg() as any;
  const next = cfg() as any;
  current.version = 'old';
  next.version = 'new';
  next.mapping = [{
    key: 'PV',
    nodeId: 'ns=2;s=PV',
    type: 'Double',
    writable: false,
    target: { mode: 'mapped-device', thingsBoardDeviceName: 'Pump A', telemetryKey: 'PV' },
    read: { enabled: true, mode: 'subscription' },
    opcua: { endpointId: 'default', nodeId: 'ns=2;s=PV', dataType: 'Double', writable: false }
  }];

  assert.equal(configRestartScope(current, next), 'hot');
});

test('config restart scope treats misplaced opcua.mappings as hot mapping update', () => {
  const current = cfg() as any;
  const next = cfg() as any;
  next.opcua.mappings = [{
    key: 'PV',
    nodeId: 'ns=2;s=PV',
    type: 'Double',
    writable: false,
    target: { mode: 'mapped-device', thingsBoardDeviceName: 'Pump A', telemetryKey: 'PV' },
    read: { enabled: true, mode: 'subscription' },
    opcua: { endpointId: 'default', nodeId: 'ns=2;s=PV', dataType: 'Double', writable: false }
  }];

  assert.equal(configRestartScope(current, next), 'hot');
});
