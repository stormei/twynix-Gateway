import { EdgeConfig, TagSpec } from './types.js';
import fs from 'fs-extra';
import path from 'path';
import { logger } from './logger.js';
import dotenv from 'dotenv';
import { normalizeMapping } from './mapping.js';
dotenv.config();

const defaultMapping: TagSpec[] = [
  { key: 'SpeedPV', nodeId: 'ns=2;s=Channel1.Device1.SpeedPV', type: 'Double', writable: false },
  { key: 'SpeedSetpoint', nodeId: 'ns=2;s=Channel1.Device1.SpeedSetpoint', type: 'Double', writable: true, min: 0, max: 5000 },
  { key: 'Enable', nodeId: 'ns=2;s=Channel1.Device1.Enable', type: 'Boolean', writable: true }
];

// Allow container/ops to mount a config file at a fixed path.
export const CONFIG_PATH = path.resolve(process.env.CONFIG_PATH || './config.json');
export const CONFIG_SCHEMA_VERSION = 'twynix.gateway.config.v1';

function buildDefaultConfig(): EdgeConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    deviceName: process.env.DEVICE_NAME || 'Machine001',
    tb: {
      url: process.env.TB_MQTT_URL || 'mqtts://tb.example.com:8883',
      accessToken: process.env.TB_ACCESS_TOKEN || 'REPLACE_ME',
      clientId: process.env.MQTT_CLIENT_ID || 'edge-gw',
      qos: 1,
      tls: true,
      caPath: process.env.TB_TLS_CA || undefined,
      certPath: process.env.TB_TLS_CERT || undefined,
      keyPath: process.env.TB_TLS_KEY || undefined,
      rejectUnauthorized: String(process.env.TB_REJECT_UNAUTHORIZED || 'true') === 'true',
      cleanSession: String(process.env.MQTT_CLEAN_SESSION || 'true') !== 'false',
      mappedDeviceTransport: (process.env.TB_MAPPED_DEVICE_TRANSPORT === 'device-sessions' ? 'device-sessions' : 'gateway-api'),
      deviceCredentials: parseDeviceCredentials(),
      alarmEvents: {
        enabled: String(process.env.TB_ALARM_EVENTS_ENABLED || 'false') === 'true',
        telemetryKey: process.env.TB_ALARM_EVENT_TELEMETRY_KEY || 'twynix_opcua_alarm_event',
        statePath: process.env.TB_ALARM_STATE_PATH || undefined,
        severityMapping: {
          criticalMin: Number(process.env.TB_ALARM_CRITICAL_MIN || 900),
          majorMin: Number(process.env.TB_ALARM_MAJOR_MIN || 800),
          warningMin: Number(process.env.TB_ALARM_WARNING_MIN || 600),
          minorMin: Number(process.env.TB_ALARM_MINOR_MIN || 300)
        }
      }
    },
    opcua: {
      url: process.env.OPCUA_URL || 'opc.tcp://127.0.0.1:49320',
      username: process.env.OPCUA_USERNAME || '',
      password: process.env.OPCUA_PASSWORD || '',
      subscribe: true,
      samplingMs: 250,
      publishingIntervalMs: Number(process.env.OPCUA_PUBLISHING_INTERVAL_MS || process.env.OPCUA_SAMPLING_MS || 1000),
      lifetimeCount: Number(process.env.OPCUA_LIFETIME_COUNT || 60),
      maxKeepAliveCount: Number(process.env.OPCUA_MAX_KEEPALIVE_COUNT || 5),
      maxNotificationsPerPublish: Number(process.env.OPCUA_MAX_NOTIFICATIONS_PER_PUBLISH || 100),
      monitoredItemQueueSize: Number(process.env.OPCUA_MONITORED_ITEM_QUEUE_SIZE || 10),
      publishRequestPipeline: Number(process.env.OPCUA_PUBLISH_REQUEST_PIPELINE || 1),
      securityPolicy: 'None',
      securityMode: 'None',
      applicationUri: process.env.OPCUA_APPLICATION_URI || undefined,
      alarms: {
        enabled: String(process.env.OPCUA_ALARMS_ENABLED || process.env.TB_ALARM_EVENTS_ENABLED || 'false') === 'true'
      }
    },
    mapping: defaultMapping.map(tag => normalizeMapping(tag)),
    sqlitePath: process.env.SQLITE_PATH || './data/messages.db',
    sqliteMaxRows: Number(process.env.SQLITE_MAX_ROWS || 500000),
    mqttFlushBatchSize: Number(process.env.MQTT_FLUSH_BATCH_SIZE || 200),
    mqttFlushDelayMs: Number(process.env.MQTT_FLUSH_DELAY_MS || 0),
    mqttFlushIntervalMs: Number(process.env.MQTT_FLUSH_INTERVAL_MS || 15000),
    logLevel: (process.env.LOG_LEVEL as EdgeConfig['logLevel']) || 'info',
    writeMinIntervalMs: Number(process.env.WRITE_MIN_INTERVAL_MS || 100),
    rpcJournalPath: process.env.RPC_JOURNAL_PATH || './data/rpc-journal.db',
    rpcJournalMaxRows: Number(process.env.RPC_JOURNAL_MAX_ROWS || 200000)
  };
}

function normalizeConfig(cfg: EdgeConfig): EdgeConfig {
  const defaults = buildDefaultConfig();
  const rawCfg = cfg as any;
  const incomingMappings = Array.isArray(rawCfg.opcua?.mappings)
    ? rawCfg.opcua.mappings
    : Array.isArray(rawCfg.mapping)
      ? rawCfg.mapping
      : Array.isArray(rawCfg.mappings)
        ? rawCfg.mappings
        : defaults.mapping;
  const { mappings: _discardOpcUaMappings, ...opcua } = (cfg.opcua || {}) as any;
  const {
    alarmApi: legacyAlarmApi,
    alarmEvents: incomingAlarmEvents,
    ...tb
  } = (cfg.tb || {}) as any;

  return {
    ...cfg,
    schemaVersion: typeof rawCfg.schemaVersion === 'string' ? rawCfg.schemaVersion : CONFIG_SCHEMA_VERSION,
    tb: {
      ...defaults.tb,
      ...tb,
      deviceCredentials: Array.isArray(cfg.tb?.deviceCredentials)
        ? cfg.tb.deviceCredentials.map((credential) => ({ ...credential }))
        : defaults.tb.deviceCredentials,
      alarmEvents: {
        ...defaults.tb.alarmEvents!,
        ...(incomingAlarmEvents || {}),
        enabled: incomingAlarmEvents?.enabled ?? legacyAlarmApi?.enabled ?? defaults.tb.alarmEvents!.enabled,
        severityMapping: {
          ...defaults.tb.alarmEvents!.severityMapping!,
          ...(incomingAlarmEvents?.severityMapping || {})
        }
      }
    },
    opcua: {
      ...defaults.opcua,
      ...opcua,
      alarms: {
        ...defaults.opcua.alarms!,
        ...(opcua.alarms || {})
      }
    },
    mapping: incomingMappings.map((tag: any) => normalizeMapping(tag)),
    mqttFlushBatchSize: Number.isFinite(cfg.mqttFlushBatchSize)
      ? cfg.mqttFlushBatchSize
      : defaults.mqttFlushBatchSize,
    mqttFlushDelayMs: Number.isFinite(cfg.mqttFlushDelayMs)
      ? cfg.mqttFlushDelayMs
      : defaults.mqttFlushDelayMs,
    mqttFlushIntervalMs: Number.isFinite(cfg.mqttFlushIntervalMs)
      ? cfg.mqttFlushIntervalMs
      : defaults.mqttFlushIntervalMs,
    rpcJournalPath: cfg.rpcJournalPath || defaults.rpcJournalPath,
    rpcJournalMaxRows: Number.isFinite(cfg.rpcJournalMaxRows)
      ? cfg.rpcJournalMaxRows
      : defaults.rpcJournalMaxRows,
  };
}

function parseDeviceCredentials() {
  const raw = process.env.TB_DEVICE_CREDENTIALS_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error: any) {
    logger.warn({ msg: 'Ignoring invalid TB_DEVICE_CREDENTIALS_JSON', error: error?.message || String(error) });
    return [];
  }
}

export function normalizeEdgeConfig(cfg: EdgeConfig): EdgeConfig {
  return normalizeConfig(cfg);
}

export async function loadConfig(): Promise<EdgeConfig> {
  if (!(await fs.pathExists(CONFIG_PATH))) {
    const cfg = buildDefaultConfig();
    validateConfig(cfg);
    await saveConfig(cfg);
    logger.info({
      msg: 'Config initialized from environment defaults',
      path: CONFIG_PATH,
      deviceName: cfg.deviceName,
      tbUrl: cfg.tb.url,
      opcuaUrl: cfg.opcua.url
    });
    return cfg;
  }
  const raw = await fs.readJson(CONFIG_PATH) as EdgeConfig & { tb?: EdgeConfig['tb'] & { alarmApi?: unknown } };
  const cfg = normalizeConfig(raw);
  validateConfig(cfg);
  if (raw.tb?.alarmApi) {
    await saveConfig(cfg);
    logger.info({
      msg: 'Migrated legacy REST alarm configuration to rule-chain alarm events and removed stored REST credential',
      path: CONFIG_PATH
    });
  }
  logger.info({
    msg: 'Config loaded',
    path: CONFIG_PATH,
    deviceName: cfg.deviceName,
    tbUrl: cfg.tb.url,
    opcuaUrl: cfg.opcua.url,
    mappingCount: cfg.mapping.length
  });
  return cfg;
}

export async function saveConfig(cfg: EdgeConfig) {
  await fs.ensureDir(path.dirname(CONFIG_PATH));
  await fs.writeJson(CONFIG_PATH, cfg, { spaces: 2 });
  logger.info({
    msg: 'Config saved',
    path: CONFIG_PATH,
    deviceName: cfg.deviceName,
    tbUrl: cfg.tb.url,
    opcuaUrl: cfg.opcua.url,
    mappingCount: cfg.mapping.length
  });
}

/**
 * Lightweight runtime validation for config coming from ThingsBoard shared attributes.
 * Keeps the gateway from bricking itself on bad JSON.
 */
export function validateConfig(cfg: EdgeConfig) {
  if (!cfg || typeof cfg !== 'object') throw new Error('Config must be an object');
  if (cfg.schemaVersion !== undefined && typeof cfg.schemaVersion !== 'string') throw new Error('schemaVersion must be a string');
  if (!cfg.deviceName || typeof cfg.deviceName !== 'string') throw new Error('deviceName is required');
  if (!cfg.tb || typeof cfg.tb !== 'object') throw new Error('tb section is required');
  if (!cfg.tb.url || typeof cfg.tb.url !== 'string') throw new Error('tb.url is required');
  if (!cfg.tb.accessToken || typeof cfg.tb.accessToken !== 'string') throw new Error('tb.accessToken is required');
  if (!cfg.tb.clientId || typeof cfg.tb.clientId !== 'string') throw new Error('tb.clientId is required');
  if (cfg.tb.qos !== 0 && cfg.tb.qos !== 1 && cfg.tb.qos !== 2) throw new Error('tb.qos must be 0|1|2');
  if (cfg.tb.mappedDeviceTransport !== undefined && cfg.tb.mappedDeviceTransport !== 'gateway-api' && cfg.tb.mappedDeviceTransport !== 'device-sessions') {
    throw new Error('tb.mappedDeviceTransport must be gateway-api|device-sessions');
  }
  if (cfg.tb.cleanSession !== undefined && typeof cfg.tb.cleanSession !== 'boolean') {
    throw new Error('tb.cleanSession must be a boolean');
  }
  if (cfg.tb.alarmEvents?.enabled !== undefined && typeof cfg.tb.alarmEvents.enabled !== 'boolean') {
    throw new Error('tb.alarmEvents.enabled must be a boolean');
  }
  if (cfg.tb.alarmEvents?.telemetryKey !== undefined && !/^[A-Za-z0-9_.-]{1,128}$/.test(cfg.tb.alarmEvents.telemetryKey)) {
    throw new Error('tb.alarmEvents.telemetryKey must contain only letters, numbers, dot, dash, or underscore');
  }
  if (cfg.tb.alarmEvents?.statePath !== undefined && typeof cfg.tb.alarmEvents.statePath !== 'string') {
    throw new Error('tb.alarmEvents.statePath must be a string');
  }
  if (cfg.tb.alarmEvents?.severityMapping) {
    const severity = cfg.tb.alarmEvents.severityMapping;
    for (const [name, value] of Object.entries(severity)) {
      if (!Number.isFinite(value) || value < 0 || value > 1000) {
        throw new Error(`tb.alarmEvents.severityMapping.${name} must be between 0 and 1000`);
      }
    }
    if (!(severity.criticalMin >= severity.majorMin &&
          severity.majorMin >= severity.warningMin &&
          severity.warningMin >= severity.minorMin)) {
      throw new Error('tb.alarmEvents severity thresholds must be descending');
    }
  }

  if (!cfg.opcua || typeof cfg.opcua !== 'object') throw new Error('opcua section is required');
  if (!cfg.opcua.url || typeof cfg.opcua.url !== 'string') throw new Error('opcua.url is required');
  if (!Number.isFinite(cfg.opcua.samplingMs) || cfg.opcua.samplingMs < 100) {
    throw new Error('opcua.samplingMs must be a number >= 100');
  }
  if (cfg.opcua.publishingIntervalMs !== undefined && (!Number.isFinite(cfg.opcua.publishingIntervalMs) || cfg.opcua.publishingIntervalMs < 100)) {
    throw new Error('opcua.publishingIntervalMs must be a number >= 100');
  }
  if (cfg.opcua.lifetimeCount !== undefined && (!Number.isFinite(cfg.opcua.lifetimeCount) || cfg.opcua.lifetimeCount < 3)) {
    throw new Error('opcua.lifetimeCount must be a number >= 3');
  }
  if (cfg.opcua.maxKeepAliveCount !== undefined && (!Number.isFinite(cfg.opcua.maxKeepAliveCount) || cfg.opcua.maxKeepAliveCount < 1)) {
    throw new Error('opcua.maxKeepAliveCount must be a number >= 1');
  }
  if (cfg.opcua.lifetimeCount !== undefined && cfg.opcua.maxKeepAliveCount !== undefined && cfg.opcua.lifetimeCount < cfg.opcua.maxKeepAliveCount * 3) {
    throw new Error('opcua.lifetimeCount must be at least 3x opcua.maxKeepAliveCount');
  }
  if (cfg.opcua.maxNotificationsPerPublish !== undefined && (!Number.isFinite(cfg.opcua.maxNotificationsPerPublish) || cfg.opcua.maxNotificationsPerPublish < 1)) {
    throw new Error('opcua.maxNotificationsPerPublish must be a number >= 1');
  }
  if (cfg.opcua.monitoredItemQueueSize !== undefined && (!Number.isFinite(cfg.opcua.monitoredItemQueueSize) || cfg.opcua.monitoredItemQueueSize < 1)) {
    throw new Error('opcua.monitoredItemQueueSize must be a number >= 1');
  }
  if (cfg.opcua.publishRequestPipeline !== undefined && (!Number.isFinite(cfg.opcua.publishRequestPipeline) || cfg.opcua.publishRequestPipeline < 1 || cfg.opcua.publishRequestPipeline > 10)) {
    throw new Error('opcua.publishRequestPipeline must be a number between 1 and 10');
  }
  if (cfg.opcua.applicationUri !== undefined && typeof cfg.opcua.applicationUri !== 'string') {
    throw new Error('opcua.applicationUri must be a string');
  }
  if (cfg.opcua.alarms?.enabled !== undefined && typeof cfg.opcua.alarms.enabled !== 'boolean') {
    throw new Error('opcua.alarms.enabled must be a boolean');
  }
  if (!Array.isArray(cfg.mapping)) throw new Error('mapping must be an array');

  for (const m of cfg.mapping) {
    if (!m || typeof m !== 'object') throw new Error('mapping item must be an object');
    if (!m.key || typeof m.key !== 'string') throw new Error('mapping.key is required');
    if (!m.nodeId || typeof m.nodeId !== 'string') throw new Error(`mapping.nodeId is required for ${m.key}`);
    if (!m.type || typeof m.type !== 'string') throw new Error(`mapping.type is required for ${m.key}`);
    if (!m.target || typeof m.target !== 'object') throw new Error(`mapping.target is required for ${m.key}`);
    if (m.target.mode !== 'gateway-device' && m.target.mode !== 'mapped-device') {
      throw new Error(`mapping.target.mode must be gateway-device|mapped-device for ${m.key}`);
    }
    if (!m.target.telemetryKey || typeof m.target.telemetryKey !== 'string') {
      throw new Error(`mapping.target.telemetryKey is required for ${m.key}`);
    }
    if (m.target.mode === 'mapped-device' && !m.target.thingsBoardDeviceId && !m.target.thingsBoardDeviceName) {
      throw new Error(`mapped-device target requires thingsBoardDeviceId or thingsBoardDeviceName for ${m.key}`);
    }
    if (m.write?.enabled && (!m.write.rpcMethod || typeof m.write.rpcMethod !== 'string')) {
      throw new Error(`mapping.write.rpcMethod is required when write.enabled=true for ${m.key}`);
    }
  }

  if (!Number.isFinite(cfg.writeMinIntervalMs) || cfg.writeMinIntervalMs < 0) {
    throw new Error('writeMinIntervalMs must be a non-negative number');
  }

  if (cfg.rpcJournalMaxRows !== undefined) {
    if (!Number.isFinite(cfg.rpcJournalMaxRows) || cfg.rpcJournalMaxRows < 1000) {
      throw new Error('rpcJournalMaxRows must be a number >= 1000');
    }
  }
  if (cfg.rpcJournalPath !== undefined && typeof cfg.rpcJournalPath !== 'string') {
    throw new Error('rpcJournalPath must be a string');
  }
  if (!Number.isFinite(cfg.sqliteMaxRows) || cfg.sqliteMaxRows < 1000) {
    throw new Error('sqliteMaxRows must be a number >= 1000');
  }
  if (cfg.mqttFlushBatchSize !== undefined && (!Number.isFinite(cfg.mqttFlushBatchSize) || cfg.mqttFlushBatchSize < 1 || cfg.mqttFlushBatchSize > 10000)) {
    throw new Error('mqttFlushBatchSize must be a number between 1 and 10000');
  }
  if (cfg.mqttFlushDelayMs !== undefined && (!Number.isFinite(cfg.mqttFlushDelayMs) || cfg.mqttFlushDelayMs < 0 || cfg.mqttFlushDelayMs > 60000)) {
    throw new Error('mqttFlushDelayMs must be a number between 0 and 60000');
  }
  if (cfg.mqttFlushIntervalMs !== undefined && (!Number.isFinite(cfg.mqttFlushIntervalMs) || cfg.mqttFlushIntervalMs < 1000 || cfg.mqttFlushIntervalMs > 3600000)) {
    throw new Error('mqttFlushIntervalMs must be a number between 1000 and 3600000');
  }
  if (!cfg.sqlitePath || typeof cfg.sqlitePath !== 'string') {
    throw new Error('sqlitePath must be a string');
  }
  if (cfg.logLevel !== 'error' && cfg.logLevel !== 'warn' && cfg.logLevel !== 'info' && cfg.logLevel !== 'debug') {
    throw new Error('logLevel must be error|warn|info|debug');
  }
}
