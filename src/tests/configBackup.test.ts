import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG_BACKUP_ATTRIBUTE_KEY,
  CONFIG_BACKUP_META_ATTRIBUTE_KEY,
  createConfigBackupEnvelope,
  extractThingsBoardConfigBackup,
  normalizeConfigBackupEnvelope,
  thingsBoardConfigBackupAttributes
} from '../configBackup.js';
import { normalizeEdgeConfig } from '../config.js';
import { EdgeConfig } from '../types.js';

function cfg(): EdgeConfig {
  return normalizeEdgeConfig({
    deviceName: 'gw',
    tb: {
      url: 'mqtt://localhost:1883',
      accessToken: 'token',
      clientId: 'gw-client',
      qos: 1,
      mappedDeviceTransport: 'gateway-api'
    },
    opcua: {
      url: 'opc.tcp://localhost:4840',
      username: '',
      password: '',
      subscribe: true,
      samplingMs: 250
    },
    mapping: [{
      key: 'PV',
      nodeId: 'ns=2;s=PV',
      type: 'Double',
      writable: false,
      target: { mode: 'gateway-device', telemetryKey: 'PV' }
    }],
    sqlitePath: './data/config-backup-test.db',
    sqliteMaxRows: 1000,
    rpcJournalPath: './data/config-backup-rpc-test.db',
    rpcJournalMaxRows: 1000,
    logLevel: 'error',
    writeMinIntervalMs: 0
  } as EdgeConfig);
}

test('config backup envelope contains full config and metadata', () => {
  const backup = createConfigBackupEnvelope(cfg(), 'test');

  assert.equal(backup.schemaVersion, 'twynix.gateway.config.backup.v1');
  assert.equal(backup.deviceName, 'gw');
  assert.equal(backup.mappingCount, 1);
  assert.equal(backup.containsSecrets, true);
  assert.equal(backup.redacted, false);
  assert.equal(backup.config.tb.accessToken, 'token');
  assert.ok(backup.hash.startsWith('sha256:'));
});

test('ThingsBoard backup attributes can be extracted from client response shape', () => {
  const backup = createConfigBackupEnvelope(cfg(), 'test');
  const attrs = thingsBoardConfigBackupAttributes(backup);
  const extracted = extractThingsBoardConfigBackup({ client: attrs });

  assert.ok(extracted);
  assert.equal(extracted.configVersion, backup.configVersion);
  assert.equal(extracted.config.mapping[0].key, 'PV');
  assert.equal(attrs[CONFIG_BACKUP_META_ATTRIBUTE_KEY].containsSecrets, true);
  assert.equal(attrs[CONFIG_BACKUP_META_ATTRIBUTE_KEY].redacted, false);
  assert.equal(attrs[CONFIG_BACKUP_ATTRIBUTE_KEY].encoding, 'gzip+base64-json');
  assert.equal('config' in attrs[CONFIG_BACKUP_ATTRIBUTE_KEY], false);
});

test('redacted config backup removes secrets and marks metadata', () => {
  const source = cfg();
  source.opcua.password = 'secret';
  source.tb.alarmEvents = {
    enabled: true,
    telemetryKey: 'twynix_opcua_alarm_event'
  };
  source.tb.deviceCredentials = [{ thingsBoardDeviceName: 'child', accessToken: 'child-token' }];

  const backup = createConfigBackupEnvelope(source, 'test', { redactSecrets: true });

  assert.equal(backup.containsSecrets, false);
  assert.equal(backup.redacted, true);
  assert.equal(backup.config.tb.accessToken, '<redacted>');
  assert.equal(backup.config.tb.alarmEvents?.telemetryKey, 'twynix_opcua_alarm_event');
  assert.equal(backup.config.opcua.password, '<redacted>');
  assert.equal(backup.config.tb.deviceCredentials?.[0].accessToken, '<redacted>');
});

test('raw config JSON can be normalized as a restore backup', () => {
  const backup = normalizeConfigBackupEnvelope(cfg());

  assert.equal(backup.deviceName, 'gw');
  assert.equal(backup.mappingCount, 1);
  assert.equal(backup.config.opcua.url, 'opc.tcp://localhost:4840');
});
