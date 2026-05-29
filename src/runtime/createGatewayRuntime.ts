import { logger } from '../logger.js';
import { MqttHandler } from '../mqtt/MqttHandler.js';
import { OpcUaClient } from '../opcua/OpcUaClient.js';
import { RpcExecutor } from '../rpc/RpcExecutor.js';
import { gatewayIdentityAttributes, gatewayStatusTelemetry } from '../status.js';
import { DeviceSessionRegistry } from '../tb/DeviceSessionRegistry.js';
import { TbBridge } from '../tb/TbBridge.js';
import { TelemetryPublisher } from '../tb/TelemetryPublisher.js';
import { ThingsBoardGatewayApi } from '../tb/ThingsBoardGatewayApi.js';
import { ConfigApplyStatus, DesiredConfigUpdate, EdgeConfig, RpcRequest, TagSpec } from '../types.js';
import type { GatewayRuntime } from './GatewayRuntime.js';

type RuntimeHandlers = {
  onApplyStoredConfig: () => Promise<any>;
  onSavePatch: (update: DesiredConfigUpdate) => Promise<ConfigApplyStatus>;
};

function toMap(tags: TagSpec[]): Map<string, TagSpec> {
  return new Map(tags.map((tag) => [tag.key, tag]));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export async function createGatewayRuntime(cfg: EdgeConfig, handlers: RuntimeHandlers): Promise<GatewayRuntime> {
  process.env.LOG_LEVEL = cfg.logLevel;

  const mqtt = new MqttHandler({
    url: cfg.tb.url,
    accessToken: cfg.tb.accessToken,
    clientId: cfg.tb.clientId,
    qos: cfg.tb.qos,
    sqlitePath: cfg.sqlitePath,
    sqliteMaxRows: cfg.sqliteMaxRows,
    flushBatchSize: cfg.mqttFlushBatchSize,
    flushDelayMs: cfg.mqttFlushDelayMs,
    flushIntervalMs: cfg.mqttFlushIntervalMs,
    caPath: cfg.tb.caPath,
    certPath: cfg.tb.certPath,
    keyPath: cfg.tb.keyPath,
    rejectUnauthorized: cfg.tb.rejectUnauthorized,
    cleanSession: cfg.tb.cleanSession
  });

  const tb = new TbBridge(mqtt, cfg, toMap(cfg.mapping));
  let activeCfg = cfg;
  let devices = new DeviceSessionRegistry(activeCfg, activeCfg.mapping);
  const tbGateway = new ThingsBoardGatewayApi(mqtt, cfg.mapping, cfg.deviceName);
  let telemetryPublisher = new TelemetryPublisher(mqtt, devices, tbGateway, activeCfg.tb.mappedDeviceTransport || 'gateway-api');
  const opc = new OpcUaClient(cfg.opcua);
  let statusInterval: NodeJS.Timeout | undefined;
  let opcSetupGeneration = 0;
  const deliveryMetrics = {
    opcSamplesReceived: 0,
    telemetryPublishAttempts: 0,
    telemetryPublishSuccess: 0,
    telemetryPublishFailures: 0,
    lastOpcSampleAt: null as number | null,
    lastTelemetryPublishAt: null as number | null,
    lastTelemetryPublishErrorAt: null as number | null,
    lastTelemetryPublishError: null as string | null,
    lastTelemetryKey: null as string | null,
    lastTelemetryTarget: null as string | null
  };

  try {
    const publishGatewayStatus = async (state = 'ready', runtimeError: string | null = null) => {
      await tb.publishTelemetry(gatewayStatusTelemetry(
        activeCfg,
        state,
        runtimeError,
        opc.isConnected(),
        opc.getLastError(),
        opc.hasActiveSubscription(),
        opc.getDiagnostics()
      ));
    };

    const startOpcInBackground = (reason: string) => {
      const generation = ++opcSetupGeneration;
      const readableMappings = activeCfg.mapping.filter((tag) => tag.read?.enabled !== false);

      const setup = activeCfg.opcua.subscribe
        ? opc.subscribe(readableMappings, activeCfg.opcua.samplingMs, async (mapping, value) => {
            const now = Date.now();
            deliveryMetrics.opcSamplesReceived += 1;
            deliveryMetrics.lastOpcSampleAt = now;
            deliveryMetrics.telemetryPublishAttempts += 1;
            deliveryMetrics.lastTelemetryKey = mapping.key;
            deliveryMetrics.lastTelemetryTarget = mapping.target?.thingsBoardDeviceName || mapping.target?.thingsBoardDeviceId || activeCfg.deviceName;
            try {
              await telemetryPublisher.publish(mapping, { [mapping.key]: value });
              deliveryMetrics.telemetryPublishSuccess += 1;
              deliveryMetrics.lastTelemetryPublishAt = Date.now();
              deliveryMetrics.lastTelemetryPublishError = null;
              (globalThis as any).lastOpcTs = Date.now();
            } catch (error: any) {
              deliveryMetrics.telemetryPublishFailures += 1;
              deliveryMetrics.lastTelemetryPublishErrorAt = Date.now();
              deliveryMetrics.lastTelemetryPublishError = error?.message || String(error);
              logger.error({ msg: 'Telemetry publish failed', key: mapping.key, error: deliveryMetrics.lastTelemetryPublishError });
            }
          })
        : opc.connect();

      setup
        .then(async () => {
          if (generation !== opcSetupGeneration) return;
          logger.info({
            msg: 'OPCUA background connection ready',
            reason,
            url: activeCfg.opcua.url,
            subscribed: activeCfg.opcua.subscribe,
            tags: readableMappings.length
          });
          await publishGatewayStatus();
        })
        .catch((error: any) => {
          if (generation !== opcSetupGeneration) return;
          logger.error({
            msg: 'OPCUA background setup failed; runtime remains degraded',
            reason,
            url: activeCfg.opcua.url,
            error: error?.message || String(error)
          });
          publishGatewayStatus('degraded', error?.message || String(error)).catch((statusError: any) => {
            logger.warn({ msg: 'Gateway degraded status publish failed', error: statusError?.message || String(statusError) });
          });
        });
    };

    let rpcExec = new RpcExecutor(activeCfg, opc, activeCfg.mapping, {
      writeTimeoutMs: 8000,
      maxPendingTotal: 500
    });

    tb.start(
      async (_reqId: string, req: RpcRequest) => {
        switch (req.method) {
          case 'writeTag':
          case 'readTag':
            return await rpcExec.handle(req);
          case 'applyConfig':
            return await handlers.onApplyStoredConfig();
          case 'opcuaBrowse': {
            if (!opc.isUsable()) {
              return { ok: false, error: 'OPC UA session is not ready', code: 'OPCUA_NOT_READY' };
            }
            const nodeId = String(req.params?.nodeId || req.params?.rootNodeId || 'RootFolder');
            const timeoutMs = Math.max(1000, Math.min(60000, Number(req.params?.timeoutMs ?? 15000)));
            const nodes = await withTimeout(opc.browse(nodeId), timeoutMs, 'OPC UA browse');
            return { ok: true, nodeId, nodes };
          }
          case 'opcuaDiscoverVariables': {
            if (!opc.isUsable()) {
              return { ok: false, error: 'OPC UA session is not ready', code: 'OPCUA_NOT_READY' };
            }
            const timeoutMs = Math.max(1000, Math.min(120000, Number(req.params?.timeoutMs ?? 15000)));
            return await withTimeout(opc.discoverVariables(
              String(req.params?.rootNodeId || req.params?.nodeId || 'RootFolder'),
              {
                maxDepth: Number(req.params?.maxDepth ?? 6),
                maxNodes: Number(req.params?.maxNodes ?? 1000),
                timeoutMs
              }
            ), timeoutMs + 1000, 'OPC UA discover variables');
          }
          default:
            throw new Error(`Unknown method ${req.method}`);
        }
      },
      async (update: DesiredConfigUpdate) => {
        return await handlers.onSavePatch(update);
      }
    );

    devices.startRpcHandlers(async (identity, _reqId, req) => {
      return await rpcExec.handleMappedDeviceRpc(identity, req);
    });
    tbGateway.startRpcHandlers(async (identity, _reqId, req) => {
      return await rpcExec.handleMappedDeviceRpc(identity, req);
    });
    await tbGateway.connectMappedDevices();

    await tb.publishClientAttributes(gatewayIdentityAttributes(cfg));
    await publishGatewayStatus();
    startOpcInBackground('startup');

    statusInterval = setInterval(() => {
      publishGatewayStatus().catch((error: any) => {
        logger.warn({ msg: 'Gateway status telemetry publish failed', error: error?.message || String(error) });
      });
    }, 30_000);

    const runtimeObject: GatewayRuntime = {
      cfg: activeCfg,
      mqtt,
      devices,
      tb,
      opc,
      getRpcStats: () => rpcExec.getStats(),
      getDeliveryMetrics: () => ({ ...deliveryMetrics }),
      updateConfigHot: async (nextCfg: EdgeConfig) => {
        activeCfg = nextCfg;
        runtimeObject.cfg = nextCfg;
        const oldDevices = devices;
        devices = new DeviceSessionRegistry(activeCfg, activeCfg.mapping);
        oldDevices.close();
        devices.startRpcHandlers(async (identity, _reqId, req) => {
          return await rpcExec.handleMappedDeviceRpc(identity, req);
        });
        tbGateway.setMappings(activeCfg.mapping);
        await tbGateway.connectMappedDevices();
        telemetryPublisher = new TelemetryPublisher(mqtt, devices, tbGateway, activeCfg.tb.mappedDeviceTransport || 'gateway-api');
        rpcExec = new RpcExecutor(activeCfg, opc, activeCfg.mapping, {
          writeTimeoutMs: 8000,
          maxPendingTotal: 500
        });
        startOpcInBackground('hot-config-update');
        await tb.publishClientAttributes(gatewayIdentityAttributes(activeCfg));
        await publishGatewayStatus();
      },
      close: async () => {
        logger.info({ msg: 'Closing runtime', deviceName: cfg.deviceName, tbUrl: cfg.tb.url, opcuaUrl: cfg.opcua.url });
        if (statusInterval) clearInterval(statusInterval);
        tb.close();
        devices.close();
        await opc.close();
        mqtt.end();
      }
    };

    return runtimeObject;
  } catch (error) {
    if (statusInterval) clearInterval(statusInterval);
    tb.close();
    devices.close();
    await opc.close().catch(() => undefined);
    mqtt.end();
    throw error;
  }
}
