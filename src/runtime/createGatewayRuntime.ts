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

  try {
    await opc.connect();

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

    if (cfg.opcua.subscribe) {
      const readableMappings = activeCfg.mapping.filter((tag) => tag.read?.enabled !== false);
      try {
        await opc.subscribe(readableMappings, cfg.opcua.samplingMs, async (mapping, value) => {
          try {
            await telemetryPublisher.publish(mapping, { [mapping.key]: value });
            (globalThis as any).lastOpcTs = Date.now();
          } catch (error: any) {
            logger.error({ msg: 'Telemetry publish failed', key: mapping.key, error: error?.message || String(error) });
          }
        });
      } catch (error: any) {
        logger.error({ msg: 'OPCUA subscription setup failed; runtime will continue degraded', error: error?.message || String(error) });
      }
    }

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
        if (activeCfg.opcua.subscribe) {
          const readableMappings = activeCfg.mapping.filter((tag) => tag.read?.enabled !== false);
          try {
            await opc.subscribe(readableMappings, activeCfg.opcua.samplingMs, async (mapping, value) => {
              try {
                await telemetryPublisher.publish(mapping, { [mapping.key]: value });
                (globalThis as any).lastOpcTs = Date.now();
              } catch (error: any) {
                logger.error({ msg: 'Telemetry publish failed', key: mapping.key, error: error?.message || String(error) });
              }
            });
          } catch (error: any) {
            logger.error({ msg: 'OPCUA hot subscription setup failed; runtime will continue degraded', error: error?.message || String(error) });
          }
        }
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
