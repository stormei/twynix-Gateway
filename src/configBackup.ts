import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import zlib from 'zlib';
import { CONFIG_PATH, normalizeEdgeConfig, validateConfig } from './config.js';
import { configVersion } from './status.js';
import { EdgeConfig } from './types.js';

export const CONFIG_BACKUP_SCHEMA = 'twynix.gateway.config.backup.v1';
export const CONFIG_BACKUP_ATTRIBUTE_KEY = 'edge.configBackup';
export const CONFIG_BACKUP_META_ATTRIBUTE_KEY = 'edge.configBackupMeta';

export type ConfigBackupEnvelope = {
  schemaVersion: typeof CONFIG_BACKUP_SCHEMA;
  createdAt: string;
  source: string;
  deviceName: string;
  configVersion: string;
  hash: string;
  mappingCount: number;
  containsSecrets: boolean;
  redacted: boolean;
  config: EdgeConfig;
};

type ThingsBoardConfigBackupPayload = ReturnType<typeof configBackupMetadata> & {
  encoding: 'gzip+base64-json';
  data: string;
};

export function backupDir() {
  return path.resolve(process.env.CONFIG_BACKUP_DIR || path.join(path.dirname(CONFIG_PATH), 'backups'));
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function sha256(value: unknown) {
  return `sha256:${crypto.createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function timestampFilePart(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function redactConfigSecrets(cfg: EdgeConfig): EdgeConfig {
  const redacted = JSON.parse(JSON.stringify(cfg)) as EdgeConfig;
  if (redacted.tb?.accessToken) redacted.tb.accessToken = '<redacted>';
  if (redacted.tb?.alarmApi?.apiKey) redacted.tb.alarmApi.apiKey = '<redacted>';
  if (Array.isArray(redacted.tb?.deviceCredentials)) {
    redacted.tb.deviceCredentials = redacted.tb.deviceCredentials.map((credential) => ({
      ...credential,
      accessToken: credential.accessToken ? '<redacted>' : credential.accessToken
    }));
  }
  if (redacted.opcua?.password) redacted.opcua.password = '<redacted>';
  return redacted;
}

export function createConfigBackupEnvelope(
  cfg: EdgeConfig,
  source: string,
  options: { redactSecrets?: boolean } = {}
): ConfigBackupEnvelope {
  const normalized = normalizeEdgeConfig(options.redactSecrets ? redactConfigSecrets(cfg) : cfg);
  validateConfig(normalized);
  return {
    schemaVersion: CONFIG_BACKUP_SCHEMA,
    createdAt: new Date().toISOString(),
    source,
    deviceName: normalized.deviceName,
    configVersion: configVersion(normalized),
    hash: sha256(normalized),
    mappingCount: normalized.mapping.length,
    containsSecrets: !options.redactSecrets,
    redacted: !!options.redactSecrets,
    config: normalized
  };
}

export function configBackupMetadata(envelope: ConfigBackupEnvelope) {
  return {
    schemaVersion: envelope.schemaVersion,
    createdAt: envelope.createdAt,
    source: envelope.source,
    deviceName: envelope.deviceName,
    configVersion: envelope.configVersion,
    hash: envelope.hash,
    mappingCount: envelope.mappingCount,
    containsSecrets: envelope.containsSecrets,
    redacted: envelope.redacted
  };
}

export function thingsBoardConfigBackupAttributes(envelope: ConfigBackupEnvelope) {
  const metadata = configBackupMetadata(envelope);
  const payload: ThingsBoardConfigBackupPayload = {
    ...metadata,
    encoding: 'gzip+base64-json',
    data: zlib.gzipSync(Buffer.from(stableJson(envelope), 'utf8')).toString('base64')
  };

  return {
    [CONFIG_BACKUP_ATTRIBUTE_KEY]: payload,
    [CONFIG_BACKUP_META_ATTRIBUTE_KEY]: metadata,
    'edge.configBackupVersion': envelope.configVersion,
    'edge.configBackupHash': envelope.hash,
    'edge.configBackupCreatedAt': envelope.createdAt
  };
}

export async function createLocalConfigBackup(cfg: EdgeConfig, source: string, options: { redactSecrets?: boolean } = {}) {
  const envelope = createConfigBackupEnvelope(cfg, source, options);
  const fileName = `config${envelope.redacted ? '-redacted' : ''}-${timestampFilePart()}-${envelope.configVersion}.json`;
  const fullPath = path.join(backupDir(), fileName);
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeJson(fullPath, envelope, { spaces: 2 });
  return {
    fileName,
    path: fullPath,
    ...configBackupMetadata(envelope)
  };
}

export async function listLocalConfigBackups() {
  const dir = backupDir();
  if (!(await fs.pathExists(dir))) return [];
  const entries = await fs.readdir(dir);
  const backups = [];

  for (const fileName of entries.filter((entry) => entry.endsWith('.json')).sort().reverse()) {
    try {
      const fullPath = path.join(dir, fileName);
      const envelope = await fs.readJson(fullPath) as ConfigBackupEnvelope;
      const stat = await fs.stat(fullPath);
      backups.push({
        fileName,
        path: fullPath,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        ...configBackupMetadata(normalizeConfigBackupEnvelope(envelope))
      });
    } catch {
      backups.push({ fileName, invalid: true });
    }
  }

  return backups;
}

export async function readLocalConfigBackup(fileName: string) {
  if (!/^[a-zA-Z0-9._-]+\.json$/.test(fileName)) {
    throw new Error('Invalid backup file name');
  }
  const fullPath = path.join(backupDir(), fileName);
  const envelope = await fs.readJson(fullPath);
  return normalizeConfigBackupEnvelope(envelope);
}

export function normalizeConfigBackupEnvelope(payload: any): ConfigBackupEnvelope {
  if (payload?.encoding === 'gzip+base64-json' && typeof payload.data === 'string') {
    const decoded = JSON.parse(zlib.gunzipSync(Buffer.from(payload.data, 'base64')).toString('utf8'));
    return normalizeConfigBackupEnvelope(decoded);
  }

  const candidate = payload?.config ? payload : { config: payload };
  const cfg = normalizeEdgeConfig(candidate.config as EdgeConfig);
  validateConfig(cfg);
  return {
    schemaVersion: CONFIG_BACKUP_SCHEMA,
    createdAt: String(candidate.createdAt || new Date().toISOString()),
    source: String(candidate.source || 'unknown'),
    deviceName: cfg.deviceName,
    configVersion: configVersion(cfg),
    hash: sha256(cfg),
    mappingCount: cfg.mapping.length,
    containsSecrets: candidate.containsSecrets ?? true,
    redacted: !!candidate.redacted,
    config: cfg
  };
}

export function extractThingsBoardConfigBackup(payload: any): ConfigBackupEnvelope | null {
  const source =
    payload?.client?.[CONFIG_BACKUP_ATTRIBUTE_KEY] ??
    payload?.[CONFIG_BACKUP_ATTRIBUTE_KEY] ??
    payload?.client?.edge?.configBackup ??
    payload?.edge?.configBackup;

  if (!source) return null;
  return normalizeConfigBackupEnvelope(source);
}
