import path from 'node:path';
import fs from 'fs-extra';
import { logger } from '../logger.js';
import { targetMode } from '../mapping.js';
import type {
  EdgeConfig,
  NormalizedAlarmEvent,
  OpcUaAlarmEvent,
  TagSpec,
  ThingsBoardAlarmSeverity
} from '../types.js';

type FetchLike = typeof fetch;

type ThingsBoardEntityId = {
  entityType: 'DEVICE';
  id: string;
};

type ThingsBoardAlarm = {
  id?: { id?: string; entityType?: string };
  originator?: ThingsBoardEntityId;
  type?: string;
  severity?: ThingsBoardAlarmSeverity;
  acknowledged?: boolean;
  cleared?: boolean;
  details?: Record<string, unknown>;
};

type TrackedAlarm = {
  event: NormalizedAlarmEvent;
  alarmId?: string;
  originator?: ThingsBoardEntityId;
};

type PersistedAlarmState = {
  schemaVersion: 'twynix.opcua-alarm-rest-state.v2';
  active: Record<string, TrackedAlarm>;
};

const STATE_SCHEMA_VERSION = 'twynix.opcua-alarm-rest-state.v2' as const;
const EVENT_SCHEMA_VERSION = 'twynix.opcua-alarm.v1' as const;

function severityMapping(cfg: EdgeConfig) {
  return {
    criticalMin: cfg.tb.alarmApi?.severityMapping?.criticalMin ?? 900,
    majorMin: cfg.tb.alarmApi?.severityMapping?.majorMin ?? 800,
    warningMin: cfg.tb.alarmApi?.severityMapping?.warningMin ?? 600,
    minorMin: cfg.tb.alarmApi?.severityMapping?.minorMin ?? 300
  };
}

export function mapAlarmSeverity(value: number, cfg: EdgeConfig): ThingsBoardAlarmSeverity {
  if (!Number.isFinite(value) || value <= 0) return 'INDETERMINATE';
  const mapping = severityMapping(cfg);
  if (value >= mapping.criticalMin) return 'CRITICAL';
  if (value >= mapping.majorMin) return 'MAJOR';
  if (value >= mapping.warningMin) return 'WARNING';
  if (value >= mapping.minorMin) return 'MINOR';
  return 'INDETERMINATE';
}

export function sourceMapping(event: Pick<OpcUaAlarmEvent, 'sourceNode'>, mappings: TagSpec[]): TagSpec | undefined {
  return mappings.find((mapping) => (mapping.opcua?.nodeId || mapping.nodeId) === event.sourceNode);
}

function conditionIdFor(event: Pick<OpcUaAlarmEvent, 'conditionId'>): string {
  const condition = String(event.conditionId || '').trim();
  if (!condition) throw new Error('OPC UA alarm requires conditionId');
  return condition;
}

export function alarmType(event: OpcUaAlarmEvent): string {
  return `OPC UA ${conditionIdFor(event)}`;
}

function stableIdentity(
  conditionId: string,
  originator: NormalizedAlarmEvent['originator']
): string {
  const originatorKey = originator.deviceId || originator.deviceName;
  if (!originatorKey) throw new Error('OPC UA alarm requires a ThingsBoard originator');
  return `${originator.mode}:${originatorKey}|${conditionId}`;
}

function eventTimestamp(value: unknown, fallback: number): number {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function normalizeStatus(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

export function normalizeAlarmEvent(event: OpcUaAlarmEvent, cfg: EdgeConfig, now = Date.now()): NormalizedAlarmEvent {
  if (!event || typeof event !== 'object') throw new Error('OPC UA alarm event must be an object');
  if (typeof event.active !== 'boolean') throw new Error('OPC UA alarm active must be a boolean');
  if (!Number.isFinite(Number(event.severity))) throw new Error('OPC UA alarm severity must be numeric');

  const conditionId = conditionIdFor(event);
  const mapped = sourceMapping(event, cfg.mapping);
  const mode = mapped ? targetMode(mapped) : 'gateway-device';
  const defaultDeviceName = cfg.tb.alarmApi?.defaultDeviceName || cfg.deviceName;
  const eventTs = eventTimestamp(event.time, now);
  const receiveTs = eventTimestamp(event.receiveTime, now);
  const originator: NormalizedAlarmEvent['originator'] = {
    mode,
    deviceId: mapped?.target?.thingsBoardDeviceId,
    deviceName: mode === 'gateway-device'
      ? defaultDeviceName
      : mapped?.target?.thingsBoardDeviceName
  };

  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    identity: stableIdentity(conditionId, originator),
    alarmType: alarmType(event),
    eventId: String(event.eventId || ''),
    conditionId,
    branchId: normalizeStatus(event.branchId),
    eventType: String(event.eventType || ''),
    sourceNodeId: String(event.sourceNode || ''),
    sourceName: String(event.sourceName || ''),
    conditionName: String(event.conditionName || ''),
    message: String(event.message || ''),
    opcUaSeverity: Number(event.severity),
    thingsBoardSeverity: mapAlarmSeverity(Number(event.severity), cfg),
    active: event.active,
    acknowledged: Boolean(event.acknowledged),
    ...(event.confirmed === undefined ? {} : { confirmed: Boolean(event.confirmed) }),
    retain: Boolean(event.retain),
    state: normalizeStatus(event.state),
    eventTs,
    receiveTs,
    quality: normalizeStatus(event.quality),
    status: normalizeStatus(event.status),
    originator,
    gateway: {
      name: cfg.deviceName
    }
  };
}

function meaningfulFingerprint(event: NormalizedAlarmEvent): string {
  return JSON.stringify({
    alarmType: event.alarmType,
    eventId: event.eventId,
    branchId: event.branchId,
    opcUaSeverity: event.opcUaSeverity,
    thingsBoardSeverity: event.thingsBoardSeverity,
    active: event.active,
    acknowledged: event.acknowledged,
    confirmed: event.confirmed,
    retain: event.retain,
    state: event.state,
    message: event.message,
    quality: event.quality,
    status: event.status,
    originator: event.originator
  });
}

export class ThingsBoardAlarmRestSync {
  private readonly active = new Map<string, TrackedAlarm>();
  private readonly fingerprints = new Map<string, string>();
  private readonly obsoleteAlarmIds = new Set<string>();
  private readonly deviceIdsByName = new Map<string, string>();
  private readonly baseUrl: string;
  private readonly statePath: string;
  private readonly requestTimeoutMs: number;
  private queue: Promise<void> = Promise.resolve();
  private loaded = false;
  private createdOrUpdated = 0;
  private cleared = 0;
  private suppressed = 0;

  constructor(
    private readonly cfg: EdgeConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly onAcknowledge?: (conditionId: string, comment: string) => Promise<unknown>
  ) {
    const alarmApi = cfg.tb.alarmApi;
    if (!alarmApi?.enabled) throw new Error('ThingsBoard Alarm REST API is not enabled');
    this.baseUrl = alarmApi.restUrl.replace(/\/+$/, '');
    this.requestTimeoutMs = Math.max(1000, Number(alarmApi.requestTimeoutMs || 10000));
    this.statePath = path.resolve(
      alarmApi.statePath ||
      path.join(path.dirname(cfg.sqlitePath), 'opcua-alarm-state.json')
    );
  }

  process(input: OpcUaAlarmEvent): Promise<void> {
    return this.enqueue(async () => {
      await this.load();
      await this.processNormalized(normalizeAlarmEvent(input, this.cfg));
    });
  }

  reconcile(snapshot: OpcUaAlarmEvent[]): Promise<void> {
    return this.enqueue(async () => {
      await this.load();
      await this.clearObsoleteBranchAlarms();
      const seen = new Set<string>();
      for (const input of snapshot) {
        const event = normalizeAlarmEvent(input, this.cfg);
        if (!event.active) continue;
        seen.add(event.identity);
        await this.processNormalized(event);
      }

      for (const [identity, tracked] of Array.from(this.active.entries())) {
        if (seen.has(identity)) continue;
        await this.clearTracked({
          ...tracked.event,
          active: false,
          retain: false,
          receiveTs: Date.now(),
          status: 'Absent from OPC UA Condition Refresh'
        }, tracked);
      }
    });
  }

  async pollAcknowledgements(): Promise<void> {
    if (!this.onAcknowledge) return;
    await this.enqueue(async () => {
      await this.load();
      for (const [identity, tracked] of this.active.entries()) {
        if (tracked.event.acknowledged || !tracked.alarmId) continue;
        const alarm = await this.request<ThingsBoardAlarm>(`/api/alarm/${encodeURIComponent(tracked.alarmId)}`);
        if (!alarm.acknowledged) continue;
        await this.onAcknowledge!(tracked.event.conditionId, 'Acknowledged in ThingsBoard');
        tracked.event = { ...tracked.event, acknowledged: true };
        this.fingerprints.set(identity, meaningfulFingerprint(tracked.event));
      }
      await this.persist();
    });
  }

  getDiagnostics() {
    return {
      enabled: true,
      transport: 'thingsboard-alarm-rest-api',
      authType: this.cfg.tb.alarmApi?.authType || 'api-key',
      trackedActiveCount: this.active.size,
      resolvedDeviceCount: this.deviceIdsByName.size,
      createdOrUpdated: this.createdOrUpdated,
      cleared: this.cleared,
      suppressed: this.suppressed,
      statePath: this.statePath
    };
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const next = this.queue.catch(() => undefined).then(action);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async processNormalized(event: NormalizedAlarmEvent): Promise<void> {
    const previous = this.active.get(event.identity);
    if (!event.active) {
      await this.clearTracked(event, previous);
      return;
    }

    const fingerprint = meaningfulFingerprint(event);
    if (previous && this.fingerprints.get(event.identity) === fingerprint) {
      this.suppressed += 1;
      return;
    }

    const originator = await this.resolveOriginator(event);
    const existingAlarmId = previous?.alarmId;
    const alarm = await this.request<ThingsBoardAlarm>('/api/alarm', {
      method: 'POST',
      body: JSON.stringify({
        ...(existingAlarmId
          ? { id: { entityType: 'ALARM', id: existingAlarmId } }
          : {}),
        originator,
        type: event.alarmType,
        severity: event.thingsBoardSeverity,
        acknowledged: event.acknowledged,
        cleared: false,
        startTs: previous?.event.eventTs || event.eventTs,
        endTs: event.receiveTs,
        details: {
          managedBy: 'twynix-gateway',
          protocol: 'OPC UA',
          schemaVersion: event.schemaVersion,
          gatewayName: event.gateway.name,
          identity: event.identity,
          conditionId: event.conditionId,
          branchId: event.branchId,
          eventId: event.eventId,
          eventType: event.eventType,
          sourceNodeId: event.sourceNodeId,
          sourceName: event.sourceName,
          conditionName: event.conditionName,
          message: event.message,
          opcUaSeverity: event.opcUaSeverity,
          state: event.state,
          retain: event.retain,
          acknowledged: event.acknowledged,
          confirmed: event.confirmed,
          quality: event.quality,
          status: event.status,
          eventTs: event.eventTs,
          receiveTs: event.receiveTs
        }
      })
    });
    const alarmId = String(alarm.id?.id || '');
    if (!alarmId) throw new Error('ThingsBoard create alarm response did not contain an alarm id');

    if (event.acknowledged && !alarm.acknowledged) {
      await this.request(`/api/alarm/${encodeURIComponent(alarmId)}/ack`, { method: 'POST' });
    }

    this.active.set(event.identity, { event, alarmId, originator });
    this.fingerprints.set(event.identity, fingerprint);
    this.createdOrUpdated += 1;
    await this.persist();
    logger.info({
      msg: 'ThingsBoard native alarm created or updated through REST API',
      alarmId,
      identity: event.identity,
      alarmType: event.alarmType,
      severity: event.thingsBoardSeverity,
      originator
    });
  }

  private async clearTracked(event: NormalizedAlarmEvent, previous?: TrackedAlarm): Promise<void> {
    const originator = previous?.originator || await this.resolveOriginator(event);
    const alarmId = previous?.alarmId || await this.findActiveAlarmId(originator, event);
    if (!alarmId) {
      this.active.delete(event.identity);
      this.fingerprints.delete(event.identity);
      this.suppressed += 1;
      await this.persist();
      logger.warn({
        msg: 'No active ThingsBoard alarm found for cleared OPC UA condition',
        identity: event.identity,
        alarmType: event.alarmType,
        originator
      });
      return;
    }

    await this.request(`/api/alarm/${encodeURIComponent(alarmId)}/clear`, { method: 'POST' });
    this.active.delete(event.identity);
    this.fingerprints.delete(event.identity);
    this.cleared += 1;
    await this.persist();
    logger.info({
      msg: 'ThingsBoard native alarm cleared through REST API',
      alarmId,
      identity: event.identity,
      alarmType: event.alarmType,
      originator
    });
  }

  private async resolveOriginator(event: NormalizedAlarmEvent): Promise<ThingsBoardEntityId> {
    if (event.originator.deviceId) {
      return { entityType: 'DEVICE', id: event.originator.deviceId };
    }
    const name = event.originator.deviceName || this.cfg.tb.alarmApi?.defaultDeviceName || this.cfg.deviceName;
    return { entityType: 'DEVICE', id: await this.resolveDeviceId(name) };
  }

  private async resolveDeviceId(deviceName: string): Promise<string> {
    const cached = this.deviceIdsByName.get(deviceName);
    if (cached) return cached;
    const device = await this.request<{ id?: { id?: string } }>(
      `/api/tenant/devices?deviceName=${encodeURIComponent(deviceName)}`
    );
    const id = String(device.id?.id || '');
    if (!id) throw new Error(`ThingsBoard device not found: ${deviceName}`);
    this.deviceIdsByName.set(deviceName, id);
    return id;
  }

  private async findActiveAlarmId(
    originator: ThingsBoardEntityId,
    event: NormalizedAlarmEvent
  ): Promise<string | undefined> {
    for (let page = 0; page < 100; page += 1) {
      const response = await this.request<{
        data?: ThingsBoardAlarm[];
        hasNext?: boolean;
        totalPages?: number;
      }>(
        `/api/alarm/${originator.entityType}/${encodeURIComponent(originator.id)}` +
        `?pageSize=100&page=${page}&searchStatus=ACTIVE&sortProperty=createdTime&sortOrder=DESC&fetchOriginator=false`
      );
      const match = (response.data || []).find((alarm) =>
        alarm.type === event.alarmType ||
        alarm.details?.identity === event.identity ||
        alarm.details?.conditionId === event.conditionId
      );
      if (match?.id?.id) return match.id.id;
      const hasNext = response.hasNext ?? (
        response.totalPages !== undefined && page + 1 < response.totalPages
      );
      if (!hasNext) break;
    }
    return undefined;
  }

  private authorizationHeader(): string {
    const api = this.cfg.tb.alarmApi!;
    if ((api.authType || 'api-key') === 'jwt') {
      return `Bearer ${api.jwtToken || ''}`;
    }
    return `ApiKey ${api.apiKey || ''}`;
  }

  private async request<T = unknown>(requestPath: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${requestPath}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Authorization': this.authorizationHeader(),
          ...(init.headers || {})
        }
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`ThingsBoard Alarm REST API ${response.status}: ${text.slice(0, 500)}`);
      }
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(`ThingsBoard Alarm REST API timed out after ${this.requestTimeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!(await fs.pathExists(this.statePath))) return;
    try {
      const raw = await fs.readJson(this.statePath) as any;
      const entries = raw?.active && typeof raw.active === 'object' ? Object.entries(raw.active) : [];
      for (const [, value] of entries) {
        const tracked = value && (value as any).event
          ? value as TrackedAlarm
          : { event: value as NormalizedAlarmEvent };
        if (!tracked.event?.active || tracked.event.schemaVersion !== EVENT_SCHEMA_VERSION) continue;
        const conditionId = String(tracked.event.conditionId || '').trim();
        if (!conditionId) continue;
        const migratedEvent: NormalizedAlarmEvent = {
          ...tracked.event,
          conditionId,
          identity: stableIdentity(conditionId, tracked.event.originator),
          alarmType: `OPC UA ${conditionId}`
        };
        const requiresRestIdentityUpdate =
          tracked.event.identity !== migratedEvent.identity ||
          tracked.event.alarmType !== migratedEvent.alarmType;
        const migrated: TrackedAlarm = { ...tracked, event: migratedEvent };
        const existing = this.active.get(migratedEvent.identity);
        if (existing?.alarmId && existing.alarmId !== migrated.alarmId) {
          this.obsoleteAlarmIds.add(existing.alarmId);
        }
        this.active.set(migratedEvent.identity, migrated);
        if (!requiresRestIdentityUpdate) {
          this.fingerprints.set(migratedEvent.identity, meaningfulFingerprint(migratedEvent));
        }
      }
    } catch (error: any) {
      logger.warn({
        msg: 'Ignoring invalid persisted OPC UA alarm state',
        statePath: this.statePath,
        error: error?.message || String(error)
      });
    }
  }

  private async clearObsoleteBranchAlarms(): Promise<void> {
    for (const alarmId of Array.from(this.obsoleteAlarmIds)) {
      try {
        await this.request(`/api/alarm/${encodeURIComponent(alarmId)}/clear`, { method: 'POST' });
        this.obsoleteAlarmIds.delete(alarmId);
        this.cleared += 1;
        logger.info({
          msg: 'Cleared obsolete branch-specific ThingsBoard alarm during identity migration',
          alarmId
        });
      } catch (error: any) {
        logger.warn({
          msg: 'Unable to clear obsolete branch-specific ThingsBoard alarm',
          alarmId,
          error: error?.message || String(error)
        });
      }
    }
  }

  private async persist(): Promise<void> {
    const state: PersistedAlarmState = {
      schemaVersion: STATE_SCHEMA_VERSION,
      active: Object.fromEntries(this.active)
    };
    await fs.ensureDir(path.dirname(this.statePath));
    const temporaryPath = `${this.statePath}.tmp`;
    await fs.writeJson(temporaryPath, state, { spaces: 2 });
    await fs.move(temporaryPath, this.statePath, { overwrite: true });
  }
}
