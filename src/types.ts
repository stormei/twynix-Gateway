export type DataTypeName = 'Boolean'|'Int16'|'UInt16'|'Int32'|'UInt32'|'Float'|'Double'|'String';

export interface OpcUaBrowseNode {
  nodeId: string;
  browseName: string;
  displayName: string;
  nodeClass: string;
  hasChildren: boolean;
  dataType?: DataTypeName;
  writable?: boolean;
}

export interface OpcUaDiscoveredVariable {
  nodeId: string;
  browsePath: string;
  displayName: string;
  dataType?: DataTypeName;
  writable?: boolean;
}

export interface OpcUaDiscoverVariablesResult {
  ok: true;
  rootNodeId: string;
  variables: OpcUaDiscoveredVariable[];
  truncated: boolean;
  scannedNodes: number;
  maxDepth: number;
  maxNodes: number;
}

export type ThingsBoardAlarmSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'WARNING' | 'INDETERMINATE';

export interface OpcUaAlarmEvent {
  conditionId: string;
  eventId: string;
  eventType: string;
  sourceNode: string;
  sourceName: string;
  conditionName: string;
  message: string;
  severity: number;
  active: boolean;
  acknowledged: boolean;
  confirmed?: boolean;
  retain: boolean;
  state?: string;
  branchId?: string;
  time: number;
  receiveTime?: number;
  quality?: string;
  status?: string;
}

export interface NormalizedAlarmEvent {
  schemaVersion: 'twynix.opcua-alarm.v1';
  identity: string;
  alarmType: string;
  eventId: string;
  conditionId: string;
  branchId?: string;
  eventType: string;
  sourceNodeId: string;
  sourceName: string;
  conditionName: string;
  message: string;
  opcUaSeverity: number;
  thingsBoardSeverity: ThingsBoardAlarmSeverity;
  active: boolean;
  acknowledged: boolean;
  confirmed?: boolean;
  retain: boolean;
  state?: string;
  eventTs: number;
  receiveTs: number;
  quality?: string;
  status?: string;
  originator: {
    mode: MappingTargetMode;
    deviceId?: string;
    deviceName?: string;
  };
  gateway: {
    id?: string;
    name: string;
  };
}

export interface TagSpec {
  key: string;
  nodeId: string;
  type: DataTypeName;
  writable: boolean;
  min?: number;
  max?: number;
  id?: string;
  name?: string;
  opcua?: {
    endpointId: string;
    nodeId: string;
    browsePath?: string;
    displayName?: string;
    dataType?: DataTypeName;
    writable?: boolean;
  };
  target?: {
    mode?: MappingTargetMode;
    thingsBoardDeviceId?: string;
    thingsBoardDeviceName?: string;
    telemetryKey: string;
  };
  read?: {
    enabled: boolean;
    mode: 'subscription' | 'polling';
    intervalMs?: number;
  };
  write?: {
    enabled: boolean;
    rpcMethod: string;
    requireReadBack?: boolean;
    min?: number;
    max?: number;
    allowedValues?: unknown[];
  };
}

export type MappingTargetMode = 'gateway-device' | 'mapped-device';

export type CommandResultCode =
  | 'OK'
  | 'NOT_ALLOWED'
  | 'UNKNOWN_METHOD'
  | 'BAD_TYPE'
  | 'OUT_OF_RANGE'
  | 'OPCUA_WRITE_FAILED'
  | 'CONFIRMATION_TIMEOUT';

export interface DeviceCredential {
  thingsBoardDeviceId?: string;
  thingsBoardDeviceName?: string;
  accessToken: string;
  clientId?: string;
}

export interface EdgeConfig {
  schemaVersion?: string;
  deviceName: string;
  tb: {
    url: string;
    accessToken: string;
    clientId: string;
    qos: 1|0|2;
    tls?: boolean;
    caPath?: string;
    certPath?: string;
    keyPath?: string;
    rejectUnauthorized?: boolean;
    cleanSession?: boolean;
    mappedDeviceTransport?: 'gateway-api' | 'device-sessions';
    deviceCredentials?: DeviceCredential[];
    alarmEvents?: {
      enabled: boolean;
      telemetryKey?: string;
      statePath?: string;
      severityMapping?: {
        criticalMin: number;
        majorMin: number;
        warningMin: number;
        minorMin: number;
      };
    };
  };
  opcua: {
    url: string;
    username?: string;
    password?: string;
    subscribe: boolean;
    samplingMs: number;
    publishingIntervalMs?: number;
    lifetimeCount?: number;
    maxKeepAliveCount?: number;
    maxNotificationsPerPublish?: number;
    monitoredItemQueueSize?: number;
    publishRequestPipeline?: number;
    securityPolicy?: 'None'|'Basic256Sha256';
    securityMode?: 'None'|'Sign'|'SignAndEncrypt';
    certificateFile?: string;
    privateKeyFile?: string;
    applicationUri?: string;
    alarms?: {
      enabled: boolean;
    };
  };
  mapping: TagSpec[];
  sqlitePath: string;
  sqliteMaxRows: number;
  mqttFlushBatchSize?: number;
  mqttFlushDelayMs?: number;
  mqttFlushIntervalMs?: number;
  // ✅ Step 3: RPC command journal (idempotency + traceability)
  // If not provided, defaults are derived in config loader.
  rpcJournalPath?: string;
  rpcJournalMaxRows?: number;
  logLevel: 'error'|'warn'|'info'|'debug';
  writeMinIntervalMs: number;
}

export interface RpcRequest {
  method: string;
  params?: any;
}

export interface DesiredConfigUpdate {
  patch: Record<string, any>;
  desiredVersion?: string;
  source: 'shared-update' | 'shared-request';
}

export interface ConfigApplyStatus {
  state: 'APPLIED' | 'FAILED';
  desiredVersion?: string;
  appliedVersion?: string;
  error?: string;
  ts: number;
}
