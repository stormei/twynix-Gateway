import { TagSpec, EdgeConfig, RpcRequest, CommandResultCode } from '../types.js';
import { logger } from '../logger.js';
import { targetMatches, validateValueForTag } from '../mapping.js';

type RpcResult = {
  ok: boolean;
  code?: CommandResultCode;
  error?: string;
  detail?: any;
  ts: number;
  latencyMs: number;
};

type OpcUaLike = {
  write: (tag: TagSpec, value: any) => Promise<any>;
  read: (tag: TagSpec) => Promise<any>;
};

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  if (!ms || ms <= 0) return p;
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (t) clearTimeout(t);
  }) as Promise<T>;
}

function isObject(x: any): x is Record<string, any> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

export class RpcExecutor {
  private readonly tagsByKey: Map<string, TagSpec>;
  private readonly mappedWrites: TagSpec[];
  private readonly allowedMethods: Set<string>;
  private readonly perTagChain = new Map<string, Promise<any>>();
  private readonly perTagPending = new Map<string, number>();
  private readonly lastWriteTs = new Map<string, number>();

  private readonly writeMinIntervalMs: number;
  private readonly writeTimeoutMs: number;
  private readonly maxPendingPerTag: number;
  private readonly maxPendingTotal: number;

  constructor(
    private readonly cfg: EdgeConfig,
    private readonly opcua: OpcUaLike,
    tags: TagSpec[],
    opts?: {
      allowedMethods?: string[];
      writeTimeoutMs?: number;
      maxPendingPerTag?: number;
      maxPendingTotal?: number;
    }
  ) {
    this.tagsByKey = new Map(tags.map((t) => [t.key, t]));
    this.mappedWrites = tags.filter((tag) => tag.target?.mode === 'mapped-device' && !!tag.write?.rpcMethod);
    this.allowedMethods = new Set((opts?.allowedMethods || ['writeTag', 'readTag', 'ping']).map(String));
    this.writeMinIntervalMs = Math.max(0, Number(cfg.writeMinIntervalMs || 0));
    this.writeTimeoutMs = Math.max(0, Number(opts?.writeTimeoutMs ?? 5000));
    this.maxPendingPerTag = Math.max(1, Number(opts?.maxPendingPerTag ?? 25));
    this.maxPendingTotal = Math.max(1, Number(opts?.maxPendingTotal ?? 250));
  }

  /**
   * Executes a TB server-side RPC command.
   * Always returns a JSON-serializable object to publish to /rpc/response/<id>.
   */
  async handle(req: RpcRequest): Promise<any> {
    const ts0 = Date.now();
    const finish = (r: Omit<RpcResult, 'ts' | 'latencyMs'>): RpcResult => ({
      ...r,
      ts: Date.now(),
      latencyMs: Date.now() - ts0,
    });

    const method = String(req?.method || '').trim();
    const params = req?.params;

    if (!method) return finish({ ok: false, code: 'UNKNOWN_METHOD', error: 'Missing method' });
    if (!this.allowedMethods.has(method)) return finish({ ok: false, code: 'UNKNOWN_METHOD', error: `Method not allowed: ${method}` });

    if (method === 'ping') {
      return finish({ ok: true, detail: { device: this.cfg.deviceName || 'unknown' } });
    }

    if (!isObject(params)) return finish({ ok: false, code: 'BAD_TYPE', error: 'params must be an object' });

    if (method === 'readTag') {
      const key = String(params.key || '').trim();
      if (!key) return finish({ ok: false, code: 'BAD_TYPE', error: 'Missing params.key' });
      const tag = this.tagsByKey.get(key);
      if (!tag) return finish({ ok: false, code: 'UNKNOWN_METHOD', error: `Unknown tag: ${key}` });
      try {
        const value = await withTimeout(this.opcua.read(tag), 3000, 'OPCUA read');
        return finish({ ok: true, detail: { key, value } });
      } catch (e: any) {
        logger.error({ msg: 'RPC readTag failed', key, err: e?.message || e });
        return finish({ ok: false, code: 'OPCUA_WRITE_FAILED', error: 'readTag failed', detail: String(e?.message || e) });
      }
    }

    if (method === 'writeTag') {
      const key = String(params.key || '').trim();
      const value = (params as any).value;
      if (!key) return finish({ ok: false, code: 'BAD_TYPE', error: 'Missing params.key' });
      const tag = this.tagsByKey.get(key);
      if (!tag) return finish({ ok: false, code: 'UNKNOWN_METHOD', error: `Unknown tag: ${key}` });
      return this.writeMapping(tag, value, finish);
    }

    // Should never reach due to allowlist above.
    return finish({ ok: false, code: 'UNKNOWN_METHOD', error: `Unhandled method: ${method}` });
  }

  async handleMappedDeviceRpc(
    identity: { deviceId?: string; deviceName?: string },
    req: RpcRequest
  ): Promise<any> {
    const ts0 = Date.now();
    const finish = (r: Omit<RpcResult, 'ts' | 'latencyMs'>): RpcResult => ({
      ...r,
      ts: Date.now(),
      latencyMs: Date.now() - ts0,
    });

    const method = String(req?.method || '').trim();
    const mapping = this.mappedWrites.find((tag) => tag.write?.rpcMethod === method && targetMatches(tag, identity));
    if (!mapping) {
      return finish({ ok: false, code: 'UNKNOWN_METHOD', error: `Unknown method ${method}` });
    }

    const params = req?.params;
    const value = isObject(params) && Object.prototype.hasOwnProperty.call(params, 'value') ? params.value : params;
    return this.writeMapping(mapping, value, finish);
  }

  private async writeMapping(
    tag: TagSpec,
    value: any,
    finish: (r: Omit<RpcResult, 'ts' | 'latencyMs'>) => RpcResult
  ): Promise<RpcResult> {
    const key = tag.key;
    const validation = validateValueForTag(tag, value);
    if (validation.code !== 'OK') {
      return finish({ ok: false, code: validation.code, error: validation.message });
    }

    const pendingForTag = this.perTagPending.get(key) || 0;
    const pendingTotal = Array.from(this.perTagPending.values()).reduce((a, b) => a + b, 0);
    if (pendingForTag >= this.maxPendingPerTag) {
      return finish({ ok: false, code: 'NOT_ALLOWED', error: `Busy: too many pending writes for ${key}` });
    }
    if (pendingTotal >= this.maxPendingTotal) {
      return finish({ ok: false, code: 'NOT_ALLOWED', error: 'Busy: too many pending writes' });
    }

    const prev = this.perTagChain.get(key) || Promise.resolve();
    this.perTagPending.set(key, pendingForTag + 1);

    const job = prev
      .catch(() => undefined)
      .then(async () => {
        if (this.writeMinIntervalMs > 0) {
          const last = this.lastWriteTs.get(key) || 0;
          const wait = this.writeMinIntervalMs - (Date.now() - last);
          if (wait > 0) await sleep(wait);
        }

        const t0 = Date.now();
        const result = await withTimeout(this.opcua.write(tag, value), this.writeTimeoutMs, 'OPCUA write');
        this.lastWriteTs.set(key, Date.now());

        if (tag.write?.requireReadBack) {
          const readBack = await withTimeout(this.opcua.read(tag), this.writeTimeoutMs, 'OPCUA readback');
          if (!Object.is(readBack, value)) {
            throw Object.assign(new Error('Readback did not confirm requested value'), {
              code: 'CONFIRMATION_TIMEOUT' satisfies CommandResultCode,
              readBack
            });
          }
        }

        logger.info({ msg: 'RPC write ok', key, value, ms: Date.now() - t0 });
        return result;
      })
      .finally(() => {
        const cur = this.perTagPending.get(key) || 1;
        const next = Math.max(0, cur - 1);
        if (next === 0) this.perTagPending.delete(key);
        else this.perTagPending.set(key, next);
      });

    this.perTagChain.set(key, job);

    try {
      const result = await job;
      return finish({ ok: true, code: 'OK', detail: { key, value, result } });
    } catch (e: any) {
      const code = (e?.code as CommandResultCode) || 'OPCUA_WRITE_FAILED';
      logger.error({ msg: 'RPC write failed', key, value, err: e?.message || e, code });
      return finish({ ok: false, code, error: code, detail: String(e?.message || e) });
    }
  }

  /** Lightweight runtime stats for /health. */
  getStats() {
    const pendingTotal = Array.from(this.perTagPending.values()).reduce((a, b) => a + b, 0);
    return {
      allowedMethods: Array.from(this.allowedMethods),
      writeMinIntervalMs: this.writeMinIntervalMs,
      writeTimeoutMs: this.writeTimeoutMs,
      pendingTotal,
      pendingByTag: Object.fromEntries(this.perTagPending.entries()),
    };
  }
}
