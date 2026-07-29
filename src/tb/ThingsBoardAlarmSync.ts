import { logger } from '../logger.js';
import type { EdgeConfig, OpcUaAlarmEvent, TagSpec, ThingsBoardAlarmSeverity } from '../types.js';

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

type SyncedAlarm = {
  alarmId: string;
  event: OpcUaAlarmEvent;
  originator: ThingsBoardEntityId;
  type: string;
};

function alarmSeverity(value: number): ThingsBoardAlarmSeverity {
  if (value >= 900) return 'CRITICAL';
  if (value >= 800) return 'MAJOR';
  if (value >= 600) return 'WARNING';
  if (value >= 300) return 'MINOR';
  return 'INDETERMINATE';
}

function conditionKey(event: OpcUaAlarmEvent): string {
  return `${event.conditionId}|${event.branchId || ''}`;
}

function alarmType(event: OpcUaAlarmEvent): string {
  const name = event.conditionName || event.sourceName || 'Condition';
  return `OPC UA ${name} [${event.conditionId}${event.branchId ? `:${event.branchId}` : ''}]`;
}

function sourceMapping(event: OpcUaAlarmEvent, mappings: TagSpec[]): TagSpec | undefined {
  return mappings.find((mapping) => {
    const nodeId = mapping.opcua?.nodeId || mapping.nodeId;
    return nodeId === event.sourceNode;
  });
}

export class ThingsBoardAlarmSync {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly deviceIdsByName = new Map<string, string>();
  private readonly syncedByCondition = new Map<string, SyncedAlarm>();
  private readonly conditionChains = new Map<string, Promise<void>>();

  constructor(
    private readonly cfg: EdgeConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly onAcknowledge?: (conditionId: string, comment: string) => Promise<unknown>
  ) {
    const alarmApi = cfg.tb.alarmApi;
    if (!alarmApi?.enabled) throw new Error('ThingsBoard alarm API is not enabled');
    this.baseUrl = alarmApi.restUrl.replace(/\/+$/, '');
    this.requestTimeoutMs = Math.max(1000, Number(alarmApi.requestTimeoutMs || 10000));
  }

  async process(event: OpcUaAlarmEvent): Promise<void> {
    const key = conditionKey(event);
    const previous = this.conditionChains.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.processOrdered(event));
    this.conditionChains.set(key, next);
    try {
      await next;
    } finally {
      if (this.conditionChains.get(key) === next) this.conditionChains.delete(key);
    }
  }

  private async processOrdered(event: OpcUaAlarmEvent): Promise<void> {
    const originator = await this.resolveOriginator(event);
    const type = alarmType(event);
    const key = conditionKey(event);

    if (event.active) {
      const alarm = await this.saveAlarm(event, originator, type);
      const alarmId = String(alarm.id?.id || '');
      if (!alarmId) throw new Error('ThingsBoard create alarm response did not contain an alarm id');
      this.syncedByCondition.set(key, { alarmId, event, originator, type });

      if (alarm.acknowledged && !event.acknowledged && this.onAcknowledge) {
        await this.onAcknowledge(event.conditionId, 'Acknowledged in ThingsBoard');
      } else if (event.acknowledged && !alarm.acknowledged) {
        await this.acknowledgeThingsBoardAlarm(alarmId);
      }
      return;
    }

    const synced = this.syncedByCondition.get(key);
    const alarmId = synced?.alarmId || (await this.findActiveAlarmId(originator, type, event.conditionId));
    if (!alarmId) {
      logger.warn({
        msg: 'No active ThingsBoard alarm found for cleared OPC UA condition',
        conditionId: event.conditionId,
        type
      });
      return;
    }
    await this.request(`/api/alarm/${encodeURIComponent(alarmId)}/clear`, { method: 'POST' });
    this.syncedByCondition.delete(key);
    logger.info({ msg: 'ThingsBoard alarm cleared', alarmId, conditionId: event.conditionId, type });
  }

  async pollAcknowledgements(): Promise<void> {
    if (!this.onAcknowledge) return;
    for (const synced of this.syncedByCondition.values()) {
      if (synced.event.acknowledged) continue;
      const alarm = await this.request<ThingsBoardAlarm>(`/api/alarm/${encodeURIComponent(synced.alarmId)}`);
      if (!alarm.acknowledged) continue;
      await this.onAcknowledge(synced.event.conditionId, 'Acknowledged in ThingsBoard');
      synced.event = { ...synced.event, acknowledged: true };
    }
  }

  async reconcile(activeConditions: OpcUaAlarmEvent[]): Promise<void> {
    const activeIds = new Set(activeConditions.filter((alarm) => alarm.active).map((alarm) => alarm.conditionId));
    const originators = await this.configuredOriginators();

    for (const originator of originators) {
      for (const alarm of await this.activeAlarms(originator)) {
        const details = alarm.details || {};
        const conditionId = String(details.conditionId || '');
        if (details.managedBy !== 'twynix-gateway' || !conditionId || activeIds.has(conditionId)) continue;
        const alarmId = String(alarm.id?.id || '');
        if (!alarmId) continue;
        await this.request(`/api/alarm/${encodeURIComponent(alarmId)}/clear`, { method: 'POST' });
        logger.info({
          msg: 'Cleared stale ThingsBoard alarm after OPC UA Condition Refresh',
          alarmId,
          conditionId
        });
      }
    }
  }

  getDiagnostics() {
    return {
      enabled: true,
      trackedAlarmCount: this.syncedByCondition.size,
      resolvedDeviceCount: this.deviceIdsByName.size
    };
  }

  private async saveAlarm(
    event: OpcUaAlarmEvent,
    originator: ThingsBoardEntityId,
    type: string
  ): Promise<ThingsBoardAlarm> {
    const alarm = await this.request<ThingsBoardAlarm>('/api/alarm', {
      method: 'POST',
      body: JSON.stringify({
        originator,
        type,
        severity: alarmSeverity(event.severity),
        acknowledged: event.acknowledged,
        cleared: false,
        startTs: event.time,
        endTs: event.receiveTime || event.time,
        details: {
          managedBy: 'twynix-gateway',
          protocol: 'OPC UA',
          conditionId: event.conditionId,
          eventId: event.eventId,
          eventType: event.eventType,
          sourceNode: event.sourceNode,
          sourceName: event.sourceName,
          conditionName: event.conditionName,
          message: event.message,
          numericSeverity: event.severity,
          state: event.state,
          branchId: event.branchId,
          retain: event.retain,
          confirmed: event.confirmed
        }
      })
    });
    logger.info({
      msg: 'ThingsBoard alarm created or updated',
      alarmId: alarm.id?.id,
      conditionId: event.conditionId,
      type,
      severity: alarmSeverity(event.severity)
    });
    return alarm;
  }

  private async resolveOriginator(event: OpcUaAlarmEvent): Promise<ThingsBoardEntityId> {
    const mapping = sourceMapping(event, this.cfg.mapping);
    const configuredId = mapping?.target?.thingsBoardDeviceId;
    if (configuredId) return { entityType: 'DEVICE', id: configuredId };

    const deviceName =
      mapping?.target?.thingsBoardDeviceName ||
      this.cfg.tb.alarmApi?.defaultDeviceName ||
      this.cfg.deviceName;
    return { entityType: 'DEVICE', id: await this.resolveDeviceId(deviceName) };
  }

  private async configuredOriginators(): Promise<ThingsBoardEntityId[]> {
    const byId = new Map<string, ThingsBoardEntityId>();
    const defaultName = this.cfg.tb.alarmApi?.defaultDeviceName || this.cfg.deviceName;
    const names = new Set<string>([defaultName]);

    for (const mapping of this.cfg.mapping) {
      const id = mapping.target?.thingsBoardDeviceId;
      if (id) byId.set(id, { entityType: 'DEVICE', id });
      else if (mapping.target?.thingsBoardDeviceName) names.add(mapping.target.thingsBoardDeviceName);
    }
    for (const name of names) {
      const id = await this.resolveDeviceId(name);
      byId.set(id, { entityType: 'DEVICE', id });
    }
    return Array.from(byId.values());
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
    type: string,
    conditionId: string
  ): Promise<string | undefined> {
    const match = (await this.activeAlarms(originator)).find(
      (alarm) => alarm.type === type || alarm.details?.conditionId === conditionId
    );
    return match?.id?.id;
  }

  private async activeAlarms(originator: ThingsBoardEntityId): Promise<ThingsBoardAlarm[]> {
    const alarms: ThingsBoardAlarm[] = [];
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const query =
        `/api/alarm/${originator.entityType}/${encodeURIComponent(originator.id)}` +
        `?pageSize=100&page=${pageNumber}` +
        '&searchStatus=ACTIVE&sortProperty=createdTime&sortOrder=DESC&fetchOriginator=false';
      const page = await this.request<{
        data?: ThingsBoardAlarm[];
        hasNext?: boolean;
        totalPages?: number;
      }>(query);
      alarms.push(...(page.data || []));
      const hasNext = page.hasNext ?? (page.totalPages !== undefined && pageNumber + 1 < page.totalPages);
      if (!hasNext) break;
    }
    return alarms;
  }

  private async acknowledgeThingsBoardAlarm(alarmId: string): Promise<void> {
    await this.request(`/api/alarm/${encodeURIComponent(alarmId)}/ack`, { method: 'POST' });
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Authorization': `ApiKey ${this.cfg.tb.alarmApi!.apiKey}`,
          ...(init.headers || {})
        }
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`ThingsBoard REST ${response.status}: ${text.slice(0, 500)}`);
      }
      return (text ? JSON.parse(text) : undefined) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export { alarmSeverity, alarmType, conditionKey, sourceMapping };
