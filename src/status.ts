import crypto from 'crypto';
import { ConfigApplyStatus, EdgeConfig } from './types.js';
import { isMappedDeviceTarget } from './mapping.js';

export function configVersion(cfg: EdgeConfig): string {
  return crypto.createHash('sha256').update(JSON.stringify(cfg)).digest('hex').slice(0, 12);
}

export function sanitizedConfigSummary(cfg: EdgeConfig) {
  return {
    schemaVersion: cfg.schemaVersion,
    deviceName: cfg.deviceName,
    tb: {
      url: cfg.tb.url,
      clientId: cfg.tb.clientId,
      qos: cfg.tb.qos,
      tls: cfg.tb.tls,
      rejectUnauthorized: cfg.tb.rejectUnauthorized,
      cleanSession: cfg.tb.cleanSession,
      mappedDeviceTransport: cfg.tb.mappedDeviceTransport || 'gateway-api',
      deviceCredentialCount: cfg.tb.deviceCredentials?.length || 0,
      alarmApiEnabled: cfg.tb.alarmApi?.enabled === true,
      alarmRestUrl: cfg.tb.alarmApi?.restUrl || '',
      alarmAuthType: cfg.tb.alarmApi?.authType || 'api-key',
      alarmCredentialConfigured: (cfg.tb.alarmApi?.authType || 'api-key') === 'jwt'
        ? !!cfg.tb.alarmApi?.jwtToken
        : !!cfg.tb.alarmApi?.apiKey,
      alarmTransport: 'thingsboard-alarm-rest-api'
    },
    opcua: {
      url: cfg.opcua.url,
      subscribe: cfg.opcua.subscribe,
      samplingMs: cfg.opcua.samplingMs,
      publishingIntervalMs: cfg.opcua.publishingIntervalMs,
      lifetimeCount: cfg.opcua.lifetimeCount,
      maxKeepAliveCount: cfg.opcua.maxKeepAliveCount,
      maxNotificationsPerPublish: cfg.opcua.maxNotificationsPerPublish,
      monitoredItemQueueSize: cfg.opcua.monitoredItemQueueSize,
      publishRequestPipeline: cfg.opcua.publishRequestPipeline,
      securityPolicy: cfg.opcua.securityPolicy,
      securityMode: cfg.opcua.securityMode,
      usernameConfigured: !!cfg.opcua.username,
      certificateConfigured: !!cfg.opcua.certificateFile,
      applicationUriConfigured: !!cfg.opcua.applicationUri,
      alarmSubscriptionEnabled: cfg.opcua.alarms?.enabled === true
    },
    mappingCount: cfg.mapping.length,
    mappedTargetDeviceCount: new Set(
      cfg.mapping
        .filter(isMappedDeviceTarget)
        .map((tag) => tag.target?.thingsBoardDeviceId || tag.target?.thingsBoardDeviceName)
        .filter(Boolean)
    ).size,
    configVersion: configVersion(cfg),
    logLevel: cfg.logLevel,
    writeMinIntervalMs: cfg.writeMinIntervalMs,
    mqttFlushBatchSize: cfg.mqttFlushBatchSize,
    mqttFlushDelayMs: cfg.mqttFlushDelayMs,
    mqttFlushIntervalMs: cfg.mqttFlushIntervalMs
  };
}

export function gatewayStatusTelemetry(
  cfg: EdgeConfig,
  state: string,
  runtimeError: string | null,
  opcConnected: boolean,
  opcLastError?: string,
  opcSubscriptionReady = false,
  opcDiagnostics?: Record<string, any>
) {
  const mappedTargetDeviceCount = new Set(
    cfg.mapping
      .filter(isMappedDeviceTarget)
      .map((tag) => tag.target?.thingsBoardDeviceId || tag.target?.thingsBoardDeviceName)
      .filter(Boolean)
  ).size;

  return {
    runtime_status: state,
    tb_rpc_ready: state === 'ready',
    opcua_connection_status: opcConnected ? 'connected' : 'disconnected',
    opcua_subscription_ready: opcSubscriptionReady,
    opcua_subscription_state: String(opcDiagnostics?.subscriptionState || (opcSubscriptionReady ? 'ready' : 'idle')),
    opcua_reconnect_count: Number(opcDiagnostics?.reconnectCount || 0),
    opcua_resubscribe_count: Number(opcDiagnostics?.resubscribeCount || 0),
    opcua_desired_tag_count: Number(opcDiagnostics?.desiredTagCount || 0),
    opcua_alarm_monitoring_ready: Boolean(opcDiagnostics?.alarmMonitoringReady),
    opcua_active_alarm_count: Number(opcDiagnostics?.activeAlarmCount || 0),
    opcua_alarm_events_received: Number(opcDiagnostics?.alarmEventsReceived || 0),
    applied_config_version: configVersion(cfg),
    mapping_count: cfg.mapping.length,
    mapped_device_transport: cfg.tb.mappedDeviceTransport || 'gateway-api',
    mapped_target_device_count: mappedTargetDeviceCount,
    last_config_error: runtimeError || opcLastError || ''
  };
}

export function gatewayIdentityAttributes(cfg: EdgeConfig) {
  return {
    edge: {
      isGateway: true,
      gatewayKind: 'opcua-service-layer',
      gatewayCapabilities: [
        'opcua.browse',
        'opcua.discoverVariables',
        'opcua.mapping.sharedConfig',
        'opcua.alarms',
        'opcua.alarms.acknowledge',
        'thingsboard.alarms.restApi'
      ],
      opcuaEndpoints: [
        {
          id: 'default',
          name: 'Default endpoint',
          url: cfg.opcua.url
        }
      ],
      config: sanitizedConfigSummary(cfg)
    },
    'edge.isGateway': true,
    'edge.gatewayKind': 'opcua-service-layer',
    'edge.gatewayCapabilities': [
      'opcua.browse',
      'opcua.discoverVariables',
      'opcua.mapping.sharedConfig',
      'opcua.alarms',
      'opcua.alarms.acknowledge',
      'thingsboard.alarms.restApi'
    ],
    'edge.opcuaEndpoints': [
      {
        id: 'default',
        name: 'Default endpoint',
        url: cfg.opcua.url
      }
    ]
  };
}

export function configApplyStatus(
  state: ConfigApplyStatus['state'],
  desiredVersion: string | undefined,
  cfg: EdgeConfig | undefined,
  error?: string
): ConfigApplyStatus {
  return {
    state,
    desiredVersion,
    appliedVersion: cfg ? configVersion(cfg) : undefined,
    error,
    ts: Date.now()
  };
}
