import { TagSpec, RpcRequest } from '../types.js';
import { logger } from '../logger.js';
import { targetDeviceName } from '../mapping.js';

type GatewayMqtt = {
  publish: (topic: string, payload: string, priority?: boolean) => Promise<void>;
  subscribe: (topic: string, handler: (topic: string, payload: Buffer) => void) => void;
  onConnect?: (listener: () => void | Promise<void>) => void;
};

export type GatewayRpcHandler = (
  identity: { deviceName: string },
  reqId: string,
  req: RpcRequest
) => Promise<any>;

export class ThingsBoardGatewayApi {
  private readonly mappedDeviceNames = new Set<string>();
  private rpcStarted = false;

  constructor(
    private readonly mqtt: GatewayMqtt,
    mappings: TagSpec[],
    private readonly gatewayDeviceName?: string
  ) {
    this.setMappings(mappings);

    this.mqtt.onConnect?.(async () => {
      await this.connectMappedDevices();
    });
  }

  getMappedDeviceCount(): number {
    return this.mappedDeviceNames.size;
  }

  setMappings(mappings: TagSpec[]) {
    this.mappedDeviceNames.clear();
    for (const mapping of mappings) {
      const name = targetDeviceName(mapping);
      if (name && this.gatewayDeviceName && name === this.gatewayDeviceName) {
        logger.error({
          msg: 'Mapped-device target points at gateway device; refusing Gateway API self-target',
          device: name,
          key: mapping.key
        });
        continue;
      }
      if (name) this.mappedDeviceNames.add(name);
    }
  }

  canPublishMapping(mapping: TagSpec): boolean {
    const device = targetDeviceName(mapping);
    return !!device && device !== this.gatewayDeviceName;
  }

  async connectMappedDevices() {
    for (const device of this.mappedDeviceNames) {
      logger.info({ msg: 'ThingsBoard gateway connecting downstream device', device });
      await this.mqtt.publish('v1/gateway/connect', JSON.stringify({ device }), true);
    }
    if (this.mappedDeviceNames.size > 0) {
      logger.info({ msg: 'ThingsBoard gateway downstream devices connected', count: this.mappedDeviceNames.size });
    }
  }

  async publishTelemetry(mapping: TagSpec, values: Record<string, any>, ts = Date.now()) {
    const device = targetDeviceName(mapping);
    if (!device) throw new Error(`Mapped-device target requires thingsBoardDeviceName for Gateway API publishing: ${mapping.key}`);
    logger.info({ msg: 'ThingsBoard gateway telemetry publish', device, key: mapping.key, telemetryKeys: Object.keys(values) });
    await this.mqtt.publish('v1/gateway/telemetry', JSON.stringify({
      [device]: [{ ts, values }]
    }));
  }

  startRpcHandlers(onRpc: GatewayRpcHandler) {
    if (this.rpcStarted) return;
    this.rpcStarted = true;

    this.mqtt.subscribe('v1/gateway/rpc', async (_topic, payload) => {
      let device = '';
      let reqId = '0';
      let response: any;
      try {
        const msg = JSON.parse(payload.toString());
        device = String(msg?.device || '').trim();
        const data = msg?.data || {};
        reqId = String(data?.id ?? msg?.id ?? '0');
        if (!device) throw new Error('Gateway RPC missing device');
        const req: RpcRequest = {
          method: String(data?.method || ''),
          params: data?.params
        };
        response = await onRpc({ deviceName: device }, reqId, req);
      } catch (error: any) {
        response = { ok: false, code: 'OPCUA_WRITE_FAILED', error: error?.message || String(error) };
      }

      if (!device) {
        logger.error({ msg: 'Cannot reply to gateway RPC without target device', reqId, response });
        return;
      }

      await this.mqtt.publish('v1/gateway/rpc', JSON.stringify({
        device,
        id: Number.isFinite(Number(reqId)) ? Number(reqId) : reqId,
        data: response
      }));
    });
  }
}
