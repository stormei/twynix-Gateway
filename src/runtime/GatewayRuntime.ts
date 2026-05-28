import { CONFIG_PATH, loadConfig, normalizeEdgeConfig, saveConfig, validateConfig } from '../config.js';
import { logger } from '../logger.js';
import type { MqttHandler } from '../mqtt/MqttHandler.js';
import type { OpcUaClient } from '../opcua/OpcUaClient.js';
import type { RpcExecutor } from '../rpc/RpcExecutor.js';
import { configRestartScope } from '../runtimeConfig.js';
import { configApplyStatus, configVersion } from '../status.js';
import type { DeviceSessionRegistry } from '../tb/DeviceSessionRegistry.js';
import type { TbBridge } from '../tb/TbBridge.js';
import { DesiredConfigUpdate, EdgeConfig } from '../types.js';
import { versionInfo } from '../version.js';
import { createGatewayRuntime } from './createGatewayRuntime.js';

export function mergeConfig(current: EdgeConfig, patch: any): EdgeConfig {
  const p = patch || {};
  const rawNextMapping = Array.isArray(p.opcua?.mappings)
    ? p.opcua.mappings
    : Array.isArray(p.mapping)
      ? p.mapping
      : Array.isArray(p.mappings)
        ? p.mappings
        : current.mapping;
  const nextMapping = preserveMappedTargets(current, rawNextMapping);
  const { mappings: _discardOpcUaMappings, ...opcuaPatch } = p.opcua || {};

  return normalizeEdgeConfig({
    ...current,
    ...p,
    tb: { ...current.tb, ...(p.tb || {}) },
    opcua: { ...current.opcua, ...opcuaPatch },
    mapping: nextMapping
  });
}

export function rejectInvalidMappedTargets(cfg: EdgeConfig) {
  const selfTargets = cfg.mapping.filter((tag) =>
    tag.target?.mode === 'mapped-device' &&
    tag.target.thingsBoardDeviceName &&
    tag.target.thingsBoardDeviceName === cfg.deviceName
  );

  if (selfTargets.length) {
    throw new Error(
      `Mapped-device target cannot be the gateway device ${cfg.deviceName}: ${selfTargets.map((tag) => tag.key).join(', ')}`
    );
  }
}

function preserveMappedTargets(current: EdgeConfig, nextMapping: any[]) {
  const currentByNode = new Map(current.mapping.map((tag) => [tag.nodeId, tag]));
  const currentByKey = new Map(current.mapping.map((tag) => [tag.key, tag]));

  return nextMapping.map((mapping) => {
    const incomingTarget = mapping?.target;
    const currentMatch = currentByNode.get(String(mapping?.nodeId || mapping?.opcua?.nodeId || '')) ||
      currentByKey.get(String(mapping?.key || mapping?.target?.telemetryKey || ''));

    if (
      currentMatch?.target?.mode === 'mapped-device' &&
      currentMatch.target.thingsBoardDeviceName &&
      currentMatch.target.thingsBoardDeviceName !== current.deviceName &&
      incomingTarget?.mode === 'mapped-device' &&
      incomingTarget?.thingsBoardDeviceName === current.deviceName
    ) {
      return {
        ...mapping,
        target: {
          ...incomingTarget,
          thingsBoardDeviceId: currentMatch.target.thingsBoardDeviceId,
          thingsBoardDeviceName: currentMatch.target.thingsBoardDeviceName
        }
      };
    }

    return mapping;
  });
}

function mappedTargetSummary(cfg: EdgeConfig) {
  return {
    mappingCount: cfg.mapping.length,
    mappedTargets: Array.from(new Set(
      cfg.mapping
        .filter((tag) => tag.target?.mode === 'mapped-device')
        .map((tag) => tag.target?.thingsBoardDeviceName || tag.target?.thingsBoardDeviceId)
        .filter(Boolean)
    )),
    gatewayDeviceMappings: cfg.mapping.filter((tag) => tag.target?.mode !== 'mapped-device').length
  };
}

export type GatewayRuntimeState = 'starting' | 'ready' | 'error';

export type GatewayRuntime = {
  cfg: EdgeConfig;
  mqtt: MqttHandler;
  devices: DeviceSessionRegistry;
  tb: TbBridge;
  opc: OpcUaClient;
  getRpcStats: () => ReturnType<RpcExecutor['getStats']>;
  updateConfigHot: (nextCfg: EdgeConfig) => Promise<void>;
  close: () => Promise<void>;
};

export class GatewayRuntimeManager {
  private runtime: GatewayRuntime | null = null;
  private runtimeState: GatewayRuntimeState = 'starting';
  private runtimeError: string | null = null;
  private configUpdateChain = Promise.resolve();
  private retryTimer?: NodeJS.Timeout;
  private retryDelayMs = 0;
  private closed = false;

  constructor(private cfg: EdgeConfig) {
    validateConfig(cfg);
  }

  get config() {
    return this.cfg;
  }

  get currentRuntime() {
    return this.runtime;
  }

  get state() {
    return this.runtimeState;
  }

  get error() {
    return this.runtimeError;
  }

  async start(reason = 'startup') {
    try {
      await this.replaceRuntime(this.cfg, reason);
    } catch (error: any) {
      this.scheduleRuntimeRetry(reason, error?.message || String(error));
      throw error;
    }
  }

  async saveAndApplyConfig(nextCfg: EdgeConfig, reason: string): Promise<EdgeConfig> {
    nextCfg = normalizeEdgeConfig(nextCfg);
    validateConfig(nextCfg);
    rejectInvalidMappedTargets(nextCfg);
    const previousRuntimeCfg = this.runtime?.cfg || this.cfg;
    await saveConfig(nextCfg);
    this.cfg = nextCfg;

    this.configUpdateChain = this.configUpdateChain
      .catch(() => undefined)
      .then(async () => {
        try {
          const scope = this.runtime ? configRestartScope(previousRuntimeCfg, nextCfg) : 'full';
          this.runtimeState = 'starting';
          this.runtimeError = null;

          if (this.runtime && scope === 'hot') {
            logger.info({ msg: 'Applying hot runtime config', reason, deviceName: nextCfg.deviceName, ...mappedTargetSummary(nextCfg) });
            await this.runtime.updateConfigHot(nextCfg);
            this.cfg = nextCfg;
            this.runtimeState = 'ready';
          } else {
            await this.replaceRuntime(nextCfg, reason);
          }
        } catch (error: any) {
          this.runtimeState = 'error';
          this.runtimeError = error?.message || String(error);
          error.configSaved = true;
          logger.error({ msg: 'Saved config but runtime apply failed', reason, error: this.runtimeError });
          this.scheduleRuntimeRetry(reason, this.runtimeError || undefined);
          throw error;
        }
      });

    await this.configUpdateChain;
    return this.cfg;
  }

  async applyStartupDesiredConfig() {
    if (!this.runtime) return;

    const desired = await this.runtime.tb.requestDesiredConfig();
    if (!desired) {
      logger.info({ msg: 'No remote desired config found on startup' });
      return;
    }

    logger.info({ msg: 'Remote desired config found on startup', desiredVersion: desired.desiredVersion });
    const current = await loadConfig();
    const merged = mergeConfig(current, desired.patch);
    await this.saveAndApplyConfig(merged, 'startup-shared-desired-config');

    if (this.runtime) {
      await this.runtime.tb.publishConfigStatus(configApplyStatus('APPLIED', desired.desiredVersion, this.cfg));
    }
  }

  getStatusPayload() {
    if (this.runtime) {
      return {
        runtimeState: this.runtimeState,
        runtimeError: this.runtimeError,
        version: versionInfo(),
        ...this.getHealthSnapshot(this.runtime)
      };
    }

    return {
      ok: false,
      runtimeState: this.runtimeState,
      runtimeError: this.runtimeError,
      version: versionInfo(),
      ts: Date.now(),
      configPath: CONFIG_PATH,
      deviceName: this.cfg.deviceName,
      mqtt: {
        connected: false,
        fresh: false,
        buffered: 0
      },
      opcua: {
        connected: false,
        fresh: false,
        subscription: false,
        lastError: this.runtimeError
      },
      rpc: {
        pendingTotal: 0
      },
      readiness: {
        tbConnected: false,
        tbRpcReady: false,
        opcuaConnected: false,
        opcuaSubscriptionReady: false,
        configState: this.runtimeState,
        mappedDeviceTransport: this.cfg.tb.mappedDeviceTransport || 'gateway-api',
        mappedTargetDeviceCount: this.getMappedTargetDeviceCount(this.cfg)
      },
      config: {
        desiredVersion: configVersion(this.cfg),
        activeRuntimeVersion: null,
        retryScheduled: !!this.retryTimer,
        retryDelayMs: this.retryDelayMs,
        tbUrl: this.cfg.tb.url,
        opcuaUrl: this.cfg.opcua.url
      }
    };
  }

  async close() {
    this.closed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    if (this.runtime) {
      await this.runtime.close();
      this.runtime = null;
    }
  }

  async publishFailedConfigStatus(error?: string) {
    if (!this.runtime) return;
    await this.runtime.tb.publishConfigStatus(configApplyStatus('FAILED', undefined, undefined, error));
  }

  private async replaceRuntime(nextCfg: EdgeConfig, reason: string) {
    validateConfig(nextCfg);
    const desiredVersion = configVersion(nextCfg);
    logger.info({
      msg: 'Applying runtime config',
      reason,
      deviceName: nextCfg.deviceName,
      desiredVersion,
      tbUrl: nextCfg.tb.url,
      opcuaUrl: nextCfg.opcua.url,
      ...mappedTargetSummary(nextCfg)
    });
    this.runtimeState = 'starting';
    this.runtimeError = null;

    if (this.runtime) {
      await this.runtime.close();
      this.runtime = null;
    }

    try {
      this.runtime = await createGatewayRuntime(nextCfg, {
        onApplyStoredConfig: async () => {
          const storedConfig = await loadConfig();
          await this.saveAndApplyConfig(storedConfig, 'rpc-apply-config');
          return { ok: true };
        },
        onSavePatch: async (patch) => {
          const update = 'patch' in patch
            ? patch as DesiredConfigUpdate
            : { patch, source: 'shared-update' as const };
          const current = await loadConfig();
          const merged = mergeConfig(current, update.patch);
          await this.saveAndApplyConfig(merged, 'shared-attribute-update');
          const status = configApplyStatus('APPLIED', update.desiredVersion, this.cfg);
          if (this.runtime) {
            await this.runtime.tb.publishConfigStatus(status);
          }
          return status;
        }
      });
      this.runtimeState = 'ready';
      this.cfg = nextCfg;
      this.retryDelayMs = 0;
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
      }
      logger.info({
        msg: 'Runtime config active',
        reason,
        activeRuntimeVersion: desiredVersion,
        tbUrl: nextCfg.tb.url,
        opcuaUrl: nextCfg.opcua.url
      });
    } catch (error: any) {
      this.runtime = null;
      this.runtimeState = 'error';
      this.runtimeError = error?.message || String(error);
      logger.error({ msg: 'Runtime apply failed', reason, error: this.runtimeError });
      throw error;
    }
  }

  private scheduleRuntimeRetry(reason: string, error?: string) {
    if (this.closed) return;

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    this.retryDelayMs = this.retryDelayMs ? Math.min(this.retryDelayMs * 2, 60_000) : 5_000;
    const desiredVersion = configVersion(this.cfg);
    logger.warn({
      msg: 'Scheduling runtime config retry',
      reason,
      desiredVersion,
      delayMs: this.retryDelayMs,
      tbUrl: this.cfg.tb.url,
      opcuaUrl: this.cfg.opcua.url,
      error
    });

    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.configUpdateChain = this.configUpdateChain
        .catch(() => undefined)
        .then(async () => {
          logger.info({
            msg: 'Retrying saved runtime config',
            reason,
            desiredVersion: configVersion(this.cfg),
            tbUrl: this.cfg.tb.url,
            opcuaUrl: this.cfg.opcua.url
          });
          await this.replaceRuntime(this.cfg, `${reason}-retry`);
        })
        .catch((retryError: any) => {
          this.scheduleRuntimeRetry(reason, retryError?.message || String(retryError));
        });
    }, this.retryDelayMs);
    this.retryTimer.unref?.();
  }

  private getHealthSnapshot(runtime: GatewayRuntime) {
    const now = Date.now();
    const mqttFresh = now - (globalThis as any).lastMqttTs < 60000;
    const opcFresh = now - (globalThis as any).lastOpcTs < 60000;
    const mqttDiagnostics = runtime.mqtt.getDiagnostics();
    const opcDiagnostics = runtime.opc.getDiagnostics();

    const snapshot = {
      ts: now,
      configPath: CONFIG_PATH,
      mqtt: {
        connected: runtime.mqtt.isConnected(),
        fresh: mqttFresh,
        buffered: runtime.mqtt.getBufferedCount(),
        diagnostics: mqttDiagnostics
      },
      opcua: {
        connected: runtime.opc.isConnected(),
        fresh: opcFresh,
        subscription: runtime.opc.hasActiveSubscription(),
        lastError: runtime.opc.getLastError() || null,
        diagnostics: opcDiagnostics
      },
      rpc: runtime.getRpcStats(),
      readiness: {
        tbConnected: runtime.mqtt.isConnected(),
        tbRpcReady: runtime.mqtt.isConnected() && this.runtimeState === 'ready',
        opcuaConnected: runtime.opc.isConnected(),
        opcuaSubscriptionReady: runtime.opc.hasActiveSubscription(),
        opcuaSubscriptionState: opcDiagnostics.subscriptionState,
        opcuaReconnectCount: opcDiagnostics.reconnectCount,
        opcuaResubscribeCount: opcDiagnostics.resubscribeCount,
        configState: this.runtimeState,
        mappedDeviceTransport: runtime.cfg.tb.mappedDeviceTransport || 'gateway-api',
        mappedTargetDeviceCount: this.getMappedTargetDeviceCount(runtime.cfg)
      },
      deviceName: runtime.cfg.deviceName
    };

    return {
      ok:
        snapshot.mqtt.connected &&
        snapshot.mqtt.fresh &&
        snapshot.opcua.connected &&
        snapshot.opcua.fresh,
      config: {
        desiredVersion: configVersion(this.cfg),
        activeRuntimeVersion: configVersion(runtime.cfg),
        retryScheduled: !!this.retryTimer,
        retryDelayMs: this.retryDelayMs,
        tbUrl: this.cfg.tb.url,
        opcuaUrl: this.cfg.opcua.url,
        activeTbUrl: runtime.cfg.tb.url,
        activeOpcuaUrl: runtime.cfg.opcua.url
      },
      ...snapshot
    };
  }

  private getMappedTargetDeviceCount(cfg: EdgeConfig) {
    return new Set(
      cfg.mapping
        .filter((tag) => tag.target?.mode === 'mapped-device')
        .map((tag) => tag.target?.thingsBoardDeviceId || tag.target?.thingsBoardDeviceName)
        .filter(Boolean)
    ).size;
  }
}
