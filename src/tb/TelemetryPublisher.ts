import { TagSpec } from '../types.js';
import { telemetryKey, targetMode } from '../mapping.js';
import { MqttHandler } from '../mqtt/MqttHandler.js';
import { DeviceSessionRegistry } from './DeviceSessionRegistry.js';
import { ThingsBoardGatewayApi } from './ThingsBoardGatewayApi.js';
import { logger } from '../logger.js';

export class TelemetryPublisher {
  constructor(
    private readonly gatewayMqtt: Pick<MqttHandler, 'publish'>,
    private readonly devices: Pick<DeviceSessionRegistry, 'getSessionForMapping'>,
    private readonly gatewayApi?: Pick<ThingsBoardGatewayApi, 'canPublishMapping' | 'publishTelemetry'>,
    private readonly mappedDeviceTransport: 'gateway-api' | 'device-sessions' = 'gateway-api'
  ) {}

  async publish(mapping: TagSpec, values: Record<string, any>, ts = Date.now()) {
    const key = telemetryKey(mapping);
    const payload = JSON.stringify({ ts, values: { [key]: values[key] ?? values[mapping.key] } });

    if (targetMode(mapping) === 'gateway-device') {
      await this.gatewayMqtt.publish('v1/devices/me/telemetry', payload);
      return;
    }

    if (this.mappedDeviceTransport === 'gateway-api' && this.gatewayApi?.canPublishMapping(mapping)) {
      await this.gatewayApi.publishTelemetry(mapping, { [key]: values[key] ?? values[mapping.key] }, ts);
      return;
    }

    if (this.mappedDeviceTransport === 'gateway-api') {
      logger.error({
        msg: 'Mapped-device telemetry cannot be published through Gateway API',
        key: mapping.key,
        target: mapping.target
      });
      return;
    }

    const session = this.devices.getSessionForMapping(mapping);
    if (!session) {
      throw new Error(`No ThingsBoard device session for mapping ${mapping.key}`);
    }
    await session.mqtt.publish('v1/devices/me/telemetry', payload);
  }
}
