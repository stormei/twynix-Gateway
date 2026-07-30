import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import { logger } from '../logger.js';
import { targetMode, telemetryKey } from '../mapping.js';
import type {
  EdgeConfig,
  NormalizedAlarmEvent,
  OpcUaAlarmEvent,
  TagSpec,
  ThingsBoardAlarmSeverity
} from '../types.js';

type AlarmTelemetryPublisher = {
  publish: (mapping: TagSpec, values: Record<string, unknown>, ts?: number) => Promise<void>;
};

type PersistedAlarmState = {
  schemaVersion: 'twynix.opcua-alarm-state.v1';
  active: Record<string, NormalizedAlarmEvent>;
};

const STATE_SCHEMA_VERSION = 'twynix.opcua-alarm-state.v1' as const;
const EVENT_SCHEMA_VERSION = 'twynix.opcua-alarm.v1' as const;

function severityMapping(cfg: EdgeConfig) {
  return {
    criticalMin: cfg.tb.alarmEvents?.severityMapping?.criticalMin ?? 900,
    majorMin: cfg.tb.alarmEvents?.severityMapping?.majorMin ?? 800,
    warningMin: cfg.tb.alarmEvents?.severityMapping?.warningMin ?? 600,
    minorMin: cfg.tb.alarmEvents?.severityMapping?.minorMin ?? 300
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

function conditionIdentity(event: Pick<OpcUaAlarmEvent, 'conditionId' | 'branchId' | 'sourceNode' | 'eventType'>): string {
  const condition = String(event.conditionId || '').trim();
  const source = String(event.sourceNode || '').trim();
  const eventType = String(event.eventType || '').trim();
  if (!condition && !source) throw new Error('OPC UA alarm requires conditionId or sourceNode');
  return `${condition || `${source}|${eventType}`}|${String(event.branchId || '')}`;
}

export function alarmType(event: OpcUaAlarmEvent): string {
  const identity = conditionIdentity(event);
  const digest = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
  const label = String(event.conditionName || event.sourceName || 'Condition')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return `OPC UA ${label || 'Condition'} [${digest}]`;
}

function eventTimestamp(value: unknown, fallback: number): number {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function normalizeStatus(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function originatorFor(event: OpcUaAlarmEvent, cfg: EdgeConfig): {
  mapping: TagSpec;
  originator: NormalizedAlarmEvent['originator'];
} {
  const mapped = sourceMapping(event, cfg.mapping);
  if (mapped) {
    const mode = targetMode(mapped);
    return {
      mapping: {
        ...mapped,
        target: {
          ...mapped.target!,
          telemetryKey: cfg.tb.alarmEvents?.telemetryKey || 'twynix_opcua_alarm_event'
        }
      },
      originator: {
        mode,
        deviceId: mapped.target?.thingsBoardDeviceId,
        deviceName: mode === 'gateway-device'
          ? cfg.deviceName
          : mapped.target?.thingsBoardDeviceName
      }
    };
  }

  const key = cfg.tb.alarmEvents?.telemetryKey || 'twynix_opcua_alarm_event';
  return {
    mapping: {
      key,
      nodeId: event.sourceNode || event.conditionId,
      type: 'String',
      writable: false,
      target: {
        mode: 'gateway-device',
        telemetryKey: key
      }
    },
    originator: {
      mode: 'gateway-device',
      deviceName: cfg.deviceName
    }
  };
}

export function normalizeAlarmEvent(event: OpcUaAlarmEvent, cfg: EdgeConfig, now = Date.now()): {
  event: NormalizedAlarmEvent;
  mapping: TagSpec;
} {
  if (!event || typeof event !== 'object') throw new Error('OPC UA alarm event must be an object');
  if (typeof event.active !== 'boolean') throw new Error('OPC UA alarm active must be a boolean');
  if (!Number.isFinite(Number(event.severity))) throw new Error('OPC UA alarm severity must be numeric');

  const identity = conditionIdentity(event);
  const { mapping, originator } = originatorFor(event, cfg);
  const eventTs = eventTimestamp(event.time, now);
  const receiveTs = eventTimestamp(event.receiveTime, now);
  const normalized: NormalizedAlarmEvent = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    identity,
    alarmType: alarmType(event),
    eventId: String(event.eventId || ''),
    conditionId: String(event.conditionId || ''),
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
  return { event: normalized, mapping };
}

function meaningfulFingerprint(event: NormalizedAlarmEvent): string {
  return JSON.stringify({
    alarmType: event.alarmType,
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

export class ThingsBoardAlarmEventPublisher {
  private readonly active = new Map<string, NormalizedAlarmEvent>();
  private readonly fingerprints = new Map<string, string>();
  private readonly telemetryKey: string;
  private readonly statePath: string;
  private queue: Promise<void> = Promise.resolve();
  private loaded = false;
  private published = 0;
  private suppressed = 0;

  constructor(
    private readonly cfg: EdgeConfig,
    private readonly telemetry: AlarmTelemetryPublisher
  ) {
    if (!cfg.tb.alarmEvents?.enabled) throw new Error('ThingsBoard alarm event publishing is not enabled');
    this.telemetryKey = cfg.tb.alarmEvents.telemetryKey || 'twynix_opcua_alarm_event';
    this.statePath = path.resolve(
      cfg.tb.alarmEvents.statePath ||
      path.join(path.dirname(cfg.sqlitePath), 'opcua-alarm-state.json')
    );
  }

  process(input: OpcUaAlarmEvent): Promise<void> {
    return this.enqueue(async () => {
      await this.load();
      const normalized = normalizeAlarmEvent(input, this.cfg);
      await this.publishIfMeaningful(normalized.event, normalized.mapping);
    });
  }

  reconcile(snapshot: OpcUaAlarmEvent[]): Promise<void> {
    return this.enqueue(async () => {
      await this.load();
      const seen = new Set<string>();
      for (const input of snapshot) {
        const normalized = normalizeAlarmEvent(input, this.cfg);
        if (!normalized.event.active) continue;
        seen.add(normalized.event.identity);
        await this.publishIfMeaningful(normalized.event, normalized.mapping);
      }

      for (const [identity, previous] of Array.from(this.active.entries())) {
        if (seen.has(identity)) continue;
        const cleared: NormalizedAlarmEvent = {
          ...previous,
          active: false,
          retain: false,
          receiveTs: Date.now(),
          status: 'Absent from OPC UA Condition Refresh'
        };
        await this.publishNormalized(cleared, mappingForNormalized(cleared, this.cfg));
        this.active.delete(identity);
        this.fingerprints.delete(identity);
      }
      await this.persist();
    });
  }

  getDiagnostics() {
    return {
      enabled: true,
      transport: 'thingsboard-rule-chain',
      telemetryKey: this.telemetryKey,
      trackedActiveCount: this.active.size,
      published: this.published,
      suppressed: this.suppressed,
      statePath: this.statePath
    };
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const next = this.queue.catch(() => undefined).then(action);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async publishIfMeaningful(event: NormalizedAlarmEvent, mapping: TagSpec): Promise<void> {
    const previous = this.active.get(event.identity);
    const fingerprint = meaningfulFingerprint(event);
    if (event.active && previous && this.fingerprints.get(event.identity) === fingerprint) {
      this.suppressed += 1;
      return;
    }
    if (!event.active && !previous) {
      this.suppressed += 1;
      return;
    }

    await this.publishNormalized(event, mapping);
    if (event.active) {
      this.active.set(event.identity, event);
      this.fingerprints.set(event.identity, fingerprint);
    } else {
      this.active.delete(event.identity);
      this.fingerprints.delete(event.identity);
    }
    await this.persist();
  }

  private async publishNormalized(event: NormalizedAlarmEvent, mapping: TagSpec): Promise<void> {
    await this.telemetry.publish(mapping, { [this.telemetryKey]: event }, event.receiveTs);
    this.published += 1;
    logger.info({
      msg: 'Normalized OPC UA alarm event published for ThingsBoard rule chain',
      identity: event.identity,
      alarmType: event.alarmType,
      active: event.active,
      severity: event.thingsBoardSeverity,
      originator: event.originator
    });
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!(await fs.pathExists(this.statePath))) return;
    try {
      const state = await fs.readJson(this.statePath) as PersistedAlarmState;
      if (state.schemaVersion !== STATE_SCHEMA_VERSION || !state.active || typeof state.active !== 'object') {
        throw new Error('unsupported alarm state schema');
      }
      for (const [identity, event] of Object.entries(state.active)) {
        if (!event?.active || event.schemaVersion !== EVENT_SCHEMA_VERSION) continue;
        this.active.set(identity, event);
        this.fingerprints.set(identity, meaningfulFingerprint(event));
      }
    } catch (error: any) {
      logger.warn({
        msg: 'Ignoring invalid persisted OPC UA alarm state',
        statePath: this.statePath,
        error: error?.message || String(error)
      });
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

function mappingForNormalized(event: NormalizedAlarmEvent, cfg: EdgeConfig): TagSpec {
  const key = cfg.tb.alarmEvents?.telemetryKey || 'twynix_opcua_alarm_event';
  if (event.originator.mode === 'mapped-device' && (event.originator.deviceName || event.originator.deviceId)) {
    return {
      key,
      nodeId: event.sourceNodeId || event.conditionId,
      type: 'String',
      writable: false,
      target: {
        mode: 'mapped-device',
        thingsBoardDeviceId: event.originator.deviceId,
        thingsBoardDeviceName: event.originator.deviceName,
        telemetryKey: key
      }
    };
  }
  return {
    key,
    nodeId: event.sourceNodeId || event.conditionId,
    type: 'String',
    writable: false,
    target: {
      mode: 'gateway-device',
      telemetryKey: key
    }
  };
}
