import { EdgeConfig, DeviceCredential, RpcRequest, TagSpec } from '../types.js';
import { MqttHandler } from '../mqtt/MqttHandler.js';
import { logger } from '../logger.js';
import { targetDeviceKey } from '../mapping.js';

export type DeviceRpcHandler = (
  identity: { deviceId?: string; deviceName?: string },
  reqId: string,
  req: RpcRequest
) => Promise<any>;

type MqttLike = Pick<MqttHandler, 'publish' | 'subscribe' | 'end' | 'isConnected' | 'getBufferedCount'>;

type Session = {
  credential: DeviceCredential;
  mqtt: MqttLike;
};

export class DeviceSessionRegistry {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly cfg: EdgeConfig,
    mappings: TagSpec[],
    private readonly factory: (credential: DeviceCredential) => MqttLike = (credential) =>
      new MqttHandler({
        url: cfg.tb.url,
        accessToken: credential.accessToken,
        clientId: credential.clientId || `${cfg.tb.clientId}-${credential.thingsBoardDeviceId || credential.thingsBoardDeviceName}`,
        qos: cfg.tb.qos,
        sqlitePath: cfg.sqlitePath.replace(/\.db$/i, `-${credential.thingsBoardDeviceId || credential.thingsBoardDeviceName}.db`),
        sqliteMaxRows: cfg.sqliteMaxRows,
        flushBatchSize: cfg.mqttFlushBatchSize,
        flushDelayMs: cfg.mqttFlushDelayMs,
        flushIntervalMs: cfg.mqttFlushIntervalMs,
        caPath: cfg.tb.caPath,
        certPath: cfg.tb.certPath,
        keyPath: cfg.tb.keyPath,
        rejectUnauthorized: cfg.tb.rejectUnauthorized
      })
  ) {
    if ((cfg.tb.mappedDeviceTransport || 'gateway-api') === 'gateway-api') {
      return;
    }

    const needed = new Set(mappings.map(targetDeviceKey).filter(Boolean) as string[]);
    for (const credential of cfg.tb.deviceCredentials || []) {
      const keys = this.credentialKeys(credential);
      if (!keys.some((key) => needed.has(key))) continue;
      const mqtt = this.factory(credential);
      const session = { credential, mqtt };
      for (const key of keys) this.sessions.set(key, session);
    }

    for (const key of needed) {
      if (!this.sessions.has(key)) {
        logger.warn({ msg: 'No ThingsBoard device credential for mapped target', target: key });
      }
    }
  }

  private credentialKeys(credential: DeviceCredential): string[] {
    return [credential.thingsBoardDeviceId, credential.thingsBoardDeviceName].filter(Boolean) as string[];
  }

  getSessionForMapping(mapping: TagSpec): Session | undefined {
    const key = targetDeviceKey(mapping);
    return key ? this.sessions.get(key) : undefined;
  }

  startRpcHandlers(onRpc: DeviceRpcHandler) {
    const uniqueSessions = new Set<Session>(this.sessions.values());
    for (const session of uniqueSessions) {
      session.mqtt.subscribe('v1/devices/me/rpc/request/+', async (topic, payload) => {
        const reqId = topic.split('/').pop() || '0';
        let response: any;
        try {
          const req = JSON.parse(payload.toString()) as RpcRequest;
          response = await onRpc(
            {
              deviceId: session.credential.thingsBoardDeviceId,
              deviceName: session.credential.thingsBoardDeviceName
            },
            reqId,
            req
          );
        } catch (error: any) {
          response = { ok: false, code: 'OPCUA_WRITE_FAILED', error: error?.message || String(error) };
        }
        await session.mqtt.publish(`v1/devices/me/rpc/response/${reqId}`, JSON.stringify(response));
      });
    }
  }

  getTargetDeviceCount(): number {
    return new Set(this.sessions.values()).size;
  }

  close() {
    for (const session of new Set(this.sessions.values())) {
      session.mqtt.end();
    }
  }
}
