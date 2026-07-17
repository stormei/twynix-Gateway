import { CommandResultCode, DataTypeName, TagSpec } from './types.js';

export function mappingId(tag: TagSpec): string {
  return tag.id || tag.key;
}

export function telemetryKey(tag: TagSpec): string {
  return tag.target?.telemetryKey || tag.key;
}

export function targetMode(tag: TagSpec): 'gateway-device' | 'mapped-device' {
  return tag.target?.mode || 'gateway-device';
}

export function isMappedDeviceTarget(tag: TagSpec): boolean {
  return targetMode(tag) === 'mapped-device';
}

export function targetDeviceKey(tag: TagSpec): string | undefined {
  if (!isMappedDeviceTarget(tag)) return undefined;
  return tag.target?.thingsBoardDeviceId || tag.target?.thingsBoardDeviceName;
}

export function targetDeviceName(tag: TagSpec): string | undefined {
  if (!isMappedDeviceTarget(tag)) return undefined;
  return tag.target?.thingsBoardDeviceName;
}

export function targetMatches(tag: TagSpec, identity: { deviceId?: string; deviceName?: string }): boolean {
  if (!isMappedDeviceTarget(tag)) return false;
  const target = tag.target;
  if (!target) return false;
  return (
    (!!target.thingsBoardDeviceId && target.thingsBoardDeviceId === identity.deviceId) ||
    (!!target.thingsBoardDeviceName && target.thingsBoardDeviceName === identity.deviceName)
  );
}

export function normalizeMapping(tag: any, endpointId = 'default'): TagSpec {
  const key = String(tag?.key || tag?.target?.telemetryKey || tag?.name || tag?.id || '').trim();
  const nodeId = String(tag?.nodeId || tag?.opcua?.nodeId || '').trim();
  const type = String(tag?.type || tag?.opcua?.dataType || 'String') as DataTypeName;
  const writable = Boolean(tag?.writable ?? tag?.opcua?.writable ?? tag?.write?.enabled ?? false);
  const hasMappedTargetIdentity = !!(tag?.target?.thingsBoardDeviceId || tag?.target?.thingsBoardDeviceName);
  const explicitTargetMode = tag?.target?.mode;
  const targetMode = explicitTargetMode === 'gateway-device'
    ? 'gateway-device'
    : explicitTargetMode === 'mapped-device' || hasMappedTargetIdentity
      ? 'mapped-device'
      : 'gateway-device';
  const telemetry = String(tag?.target?.telemetryKey || key).trim();
  const rpcMethod = String(tag?.write?.rpcMethod || `write.${key}`).trim();
  const writeEnabled = Boolean(tag?.write?.enabled ?? writable);

  return {
    ...tag,
    key,
    nodeId,
    type,
    writable,
    min: tag?.min,
    max: tag?.max,
    id: String(tag?.id || key).trim(),
    name: String(tag?.name || tag?.displayName || key).trim(),
    opcua: {
      endpointId: String(tag?.opcua?.endpointId || endpointId),
      nodeId,
      browsePath: tag?.opcua?.browsePath,
      displayName: tag?.opcua?.displayName || tag?.displayName,
      dataType: type,
      writable
    },
    target: {
      mode: targetMode,
      thingsBoardDeviceId: targetMode === 'mapped-device' ? tag?.target?.thingsBoardDeviceId : undefined,
      thingsBoardDeviceName: targetMode === 'mapped-device' ? tag?.target?.thingsBoardDeviceName : undefined,
      telemetryKey: telemetry || key
    },
    read: {
      enabled: tag?.read?.enabled !== false,
      mode: tag?.read?.mode === 'polling' ? 'polling' : 'subscription',
      intervalMs: tag?.read?.intervalMs
    },
    write: {
      enabled: writeEnabled,
      rpcMethod,
      requireReadBack: Boolean(tag?.write?.requireReadBack),
      min: typeof tag?.write?.min === 'number' ? tag.write.min : tag?.min,
      max: typeof tag?.write?.max === 'number' ? tag.write.max : tag?.max,
      allowedValues: Array.isArray(tag?.write?.allowedValues) ? tag.write.allowedValues : undefined
    }
  };
}

export function validateValueForTag(tag: TagSpec, value: any): { code: CommandResultCode; message?: string } {
  if (!tag.write?.enabled) return { code: 'NOT_ALLOWED', message: 'Write is not enabled for this mapping' };

  const type = tag.type;
  if (type === 'Boolean' && typeof value !== 'boolean') return { code: 'BAD_TYPE', message: 'Expected boolean' };
  if (type === 'String' && typeof value !== 'string') return { code: 'BAD_TYPE', message: 'Expected string' };
  if (type !== 'Boolean' && type !== 'String') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { code: 'BAD_TYPE', message: 'Expected finite number' };
    }
  }

  const min = tag.write.min ?? tag.min;
  const max = tag.write.max ?? tag.max;
  if (typeof min === 'number' && Number(value) < min) return { code: 'OUT_OF_RANGE', message: `Below min ${min}` };
  if (typeof max === 'number' && Number(value) > max) return { code: 'OUT_OF_RANGE', message: `Above max ${max}` };
  if (tag.write.allowedValues && !tag.write.allowedValues.some((allowed) => Object.is(allowed, value))) {
    return { code: 'OUT_OF_RANGE', message: 'Value is not in allowedValues' };
  }

  return { code: 'OK' };
}
