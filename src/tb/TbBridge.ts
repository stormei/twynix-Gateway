// src/tb/TbBridge.ts
import { MqttHandler } from '../mqtt/MqttHandler.js';
import { ConfigApplyStatus, DesiredConfigUpdate, EdgeConfig, RpcRequest, TagSpec } from '../types.js';
import { logger } from '../logger.js';
import { CommandStore } from '../storage/CommandStore.js';

export class TbBridge {
  private cmdStore: CommandStore;
  private inFlight = new Map<string, Promise<any>>();
  private attrRequestSeq = 1;
  private attrWaiters = new Map<string, (payload: any) => void>();
  private closed = false;
  private readonly rpcResponseMaxBytes = 64 * 1024;
  private readonly rpcReplayTtlMs = 30_000;

  constructor(
    private mqtt: MqttHandler,
    private cfg: EdgeConfig,
    private mapping: Map<string, TagSpec>
  ) {
    // ✅ Step 3: journal every RPC request/response for audit + idempotency
    const journalPath =
      cfg.rpcJournalPath || cfg.sqlitePath.replace(/\.db$/i, '') + '-rpc.db';
    const journalMax = typeof cfg.rpcJournalMaxRows === 'number' ? cfg.rpcJournalMaxRows : 200000;
    this.cmdStore = new CommandStore(journalPath, journalMax);
  }

  /**
   * Wires TB RPC and Shared Attribute updates to your handlers.
   * - onRpc(reqId, req): implement applyConfig/readTag/writeTag, etc.
   * - onSharedConfig(patch): persist validated patch to config.json (your index.ts already does this)
   */
  start(
    onRpc: (reqId: string, req: RpcRequest) => Promise<any>,
    onSharedConfig: (update: DesiredConfigUpdate) => Promise<ConfigApplyStatus>
  ) {
    // ---------- RPC ----------
    this.mqtt.subscribe('v1/devices/me/rpc/request/+', async (topic, payload) => {
      const reqId = topic.split('/').pop() || '0';
      try {
        const req = JSON.parse(payload.toString()) as RpcRequest;
        const method = String((req as any)?.method || '');
        logger.info({ msg: 'RPC request', reqId, method });

        // 1) If already completed earlier -> replay exact response (idempotent)
        // CommandStore API: get()/upsertPending()/markDone()/markError()
        const existing = this.cmdStore.get(reqId);
        if (
          existing &&
          (existing.status === 'done' || existing.status === 'error') &&
          existing.responseJson &&
          existing.completedTs &&
          Date.now() - existing.completedTs < this.rpcReplayTtlMs
        ) {
          logger.info({ msg: 'RPC replayed from journal', reqId, status: existing.status });
          await this.publishRpcResponse(reqId, JSON.parse(existing.responseJson));
          return;
        }

        // 2) If in-flight duplicate -> await same promise and reply once
        const inflight = this.inFlight.get(reqId);
        if (inflight) {
          logger.warn({ msg: 'RPC duplicate while in-flight; awaiting', reqId });
          const r = await inflight;
          await this.publishRpcResponse(reqId, r ?? { ok: true });
          return;
        }

        // 3) Journal + execute
        this.cmdStore.upsertPending(reqId, method, JSON.stringify((req as any)?.params ?? {}), Date.now());

        const p = (async () => {
          try {
            const result = await onRpc(reqId, req);
            const response = result ?? { ok: true };
            this.cmdStore.markDone(reqId, JSON.stringify(response));
            return response;
          } catch (e: any) {
            const response = { ok: false, error: e?.message || String(e) };
            this.cmdStore.markError(reqId, e?.message || String(e), JSON.stringify(response));
            throw Object.assign(new Error(response.error), { __rpcResponse: response });
          }
        })();
        this.inFlight.set(reqId, p);

        try {
          const response = await p;
          await this.publishRpcResponse(reqId, response);
        } finally {
          this.inFlight.delete(reqId);
        }
      } catch (e: any) {
        const response = (e as any)?.__rpcResponse || { ok: false, error: e?.message || String(e) };
        logger.error({ msg: 'RPC handler error', reqId, error: response.error });
        await this.publishRpcResponse(reqId, response);
      }
    });

    // ---------- Shared attribute updates ----------
    // TB publishes shared attrs to this topic as a plain object of changed keys.
    // We accept multiple shapes:
    //  A) { "edge.desiredConfig": { ... } }                 <-- your current setup
    //  B) { "edge": { "desiredConfig": { ... } } }
    //  C) { "shared": { "edge.desiredConfig": { ... } } }   (seen in some flows)
    //  D) { "shared": { "edge": { "desiredConfig": { ... } } } }
    this.mqtt.subscribe('v1/devices/me/attributes/response/+', async (topic, payload) => {
      const reqId = topic.split('/').pop() || '';
      const waiter = this.attrWaiters.get(reqId);
      if (!waiter) return;
      this.attrWaiters.delete(reqId);
      try {
        waiter(JSON.parse(payload.toString()));
      } catch {
        waiter({});
      }
    });

    this.mqtt.subscribe('v1/devices/me/attributes', async (_topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString());
        const desired = extractDesiredConfigUpdate(msg, 'shared-update');

        if (desired) {
          logger.info({
            msg: 'Shared desiredConfig received',
            desiredVersion: desired.desiredVersion,
            mappingLen: Array.isArray(desired.patch?.mapping) ? desired.patch.mapping.length : undefined
          });

          await onSharedConfig(desired);
        } else {
          // Uncomment for troubleshooting to see the exact shape you received:
          // logger.warn({ msg: 'No desiredConfig found in attributes payload', keys: Object.keys(msg || {}) });
        }
      } catch (e: any) {
        logger.error({ msg: 'Bad attributes payload', error: e?.message || String(e) });
        if (!this.closed) {
          await this.publishConfigStatus({
            state: 'FAILED',
            error: e?.message || String(e),
            ts: Date.now()
          });
        }
      }
    });
  }

  async requestDesiredConfig(timeoutMs = 8000): Promise<DesiredConfigUpdate | null> {
    const response = await this.requestAttributes({
      sharedKeys: 'edge.desiredConfig,edge.desiredConfigVersion,edge'
    }, timeoutMs, 'Shared attribute request failed');

    if (!response) return null;
    return extractDesiredConfigUpdate(response, 'shared-request');
  }

  async requestConfigBackup(timeoutMs = 8000): Promise<any | null> {
    return this.requestAttributes({
      clientKeys: 'edge.configBackup,edge.configBackupMeta,edge.configBackupVersion,edge.configBackupHash,edge.configBackupCreatedAt,edge'
    }, timeoutMs, 'Config backup attribute request failed');
  }

  private async requestAttributes(payload: { clientKeys?: string; sharedKeys?: string }, timeoutMs: number, failureMessage: string) {
    const reqId = String(this.attrRequestSeq++);

    const response = await new Promise<any>((resolve) => {
      const timer = setTimeout(() => {
        this.attrWaiters.delete(reqId);
        resolve(null);
      }, timeoutMs);

      this.attrWaiters.set(reqId, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });

      this.mqtt.publish(`v1/devices/me/attributes/request/${reqId}`, JSON.stringify(payload), true)
        .catch((error: any) => {
          clearTimeout(timer);
          this.attrWaiters.delete(reqId);
          logger.error({ msg: failureMessage, error: error?.message || String(error) });
          resolve(null);
        });
    });

    return response;
  }

  async publishTelemetry(values: Record<string, any>) {
    const ts = Date.now();
    await this.mqtt.publish('v1/devices/me/telemetry', JSON.stringify({ ts, values }));
  }

  async publishClientAttributes(attrs: Record<string, any>) {
    // priority=true → push immediately and trigger buffer flush
    await this.mqtt.publish('v1/devices/me/attributes', JSON.stringify(attrs), true);
  }

  async publishConfigStatus(status: ConfigApplyStatus) {
    await this.publishClientAttributes({ edge: { configStatus: status } });
    await this.publishTelemetry({
      config_apply_state: status.state,
      desired_config_version: status.desiredVersion || '',
      applied_config_version: status.appliedVersion || '',
      last_config_error: status.error || ''
    });
  }

  private async publishRpcResponse(reqId: string, response: any) {
    let payload = JSON.stringify(response ?? { ok: true });
    const bytes = Buffer.byteLength(payload, 'utf8');
    if (bytes > this.rpcResponseMaxBytes) {
      logger.warn({ msg: 'RPC response too large; returning compact error', reqId, bytes, maxBytes: this.rpcResponseMaxBytes });
      payload = JSON.stringify({
        ok: false,
        code: 'RPC_RESPONSE_TOO_LARGE',
        error: `RPC response exceeded ${this.rpcResponseMaxBytes} bytes`
      });
    }
    await this.mqtt.publish(`v1/devices/me/rpc/response/${reqId}`, payload);
  }

  close() {
    this.closed = true;
    this.attrWaiters.clear();
    this.cmdStore.close();
  }
}

export function extractDesiredConfigUpdate(msg: any, source: DesiredConfigUpdate['source']): DesiredConfigUpdate | null {
  const shared = msg?.shared || msg;
  const patch =
    shared?.['edge.desiredConfig'] ??
    shared?.edge?.desiredConfig ??
    msg?.['edge.desiredConfig'] ??
    msg?.edge?.desiredConfig;

  if (!patch || typeof patch !== 'object') return null;

  const desiredVersion = String(
    shared?.['edge.desiredConfigVersion'] ??
      shared?.edge?.desiredConfigVersion ??
      patch.version ??
      patch.configVersion ??
      ''
  ).trim() || undefined;

  return { patch, desiredVersion, source };
}
