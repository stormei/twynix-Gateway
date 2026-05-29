import mqtt, { MqttClient } from 'mqtt';
import fs from 'fs';
import { MessageStore, BufferedMessage } from '../storage/MessageStore.js';
import { logger } from '../logger.js';

type Handler = (topic: string, payload: Buffer) => void;

function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    const fl = f[i];
    const tl = t[i];
    if (fl === '#') return true;
    if (fl === '+') { if (tl === undefined) return false; continue; }
    if (tl === undefined) return false;
    if (fl !== tl) return false;
  }
  return f.length === t.length || f[f.length - 1] === '#';
}

function isEphemeralTopic(topic: string): boolean {
  return /^v1\/devices\/me\/rpc\/response\/[^/]+$/.test(topic) || topic === 'v1/gateway/rpc';
}

export interface MqttOptions {
  url: string;
  accessToken: string;
  clientId: string;
  qos: 0|1|2;
  sqlitePath: string;
  sqliteMaxRows: number;
  flushBatchSize?: number;
  flushDelayMs?: number;
  flushIntervalMs?: number;
  caPath?: string;
  certPath?: string;
  keyPath?: string;
  rejectUnauthorized?: boolean;
  cleanSession?: boolean;
}

export class MqttHandler {
  private client!: MqttClient;
  private store: MessageStore;
  private qos: 0|1|2;
  private url: string;
  private clientId: string;
  private subs: Array<{ topic: string, handler: Handler }> = [];
  private flushing = false;
  private connected = false;
  private ended = false;
  private timer?: NodeJS.Timeout;
  private connectListeners: Array<() => void | Promise<void>> = [];
  private lastPublishedTopic: string | null = null;
  private lastEvent = 'initialized';
  private lastEventAt = Date.now();
  private lastError: string | null = null;
  private lastDisconnectReasonCode: number | null = null;
  private flushBatchSize: number;
  private flushDelayMs: number;
  private flushIntervalMs: number;
  private metrics = {
    publishAttempts: 0,
    publishSuccess: 0,
    publishFailures: 0,
    bufferedAdded: 0,
    bufferedPurged: 0,
    bufferedDroppedEphemeral: 0,
    bufferedFlushed: 0,
    flushRuns: 0,
    flushFailures: 0,
    lastFlushStartedAt: null as number | null,
    lastFlushFinishedAt: null as number | null,
    lastFlushDurationMs: null as number | null,
    lastFlushPublished: 0,
    lastFlushRatePerSec: 0,
    connects: 0,
    reconnects: 0,
    closes: 0,
    offlineEvents: 0,
    errors: 0
  };

  private recordEvent(event: string) {
    this.lastEvent = event;
    this.lastEventAt = Date.now();
  }

  constructor(opts: MqttOptions) {
    this.store = new MessageStore(opts.sqlitePath, opts.sqliteMaxRows);
    this.qos = opts.qos;
    this.url = opts.url;
    this.clientId = opts.clientId;
    this.flushBatchSize = Math.max(1, Math.floor(opts.flushBatchSize ?? 200));
    this.flushDelayMs = Math.max(0, Math.floor(opts.flushDelayMs ?? 0));
    this.flushIntervalMs = Math.max(1000, Math.floor(opts.flushIntervalMs ?? 15000));

    const tls: any = {};
    if (opts.caPath) try { tls.ca = fs.readFileSync(opts.caPath); } catch {}
    if (opts.certPath) try { tls.cert = fs.readFileSync(opts.certPath); } catch {}
    if (opts.keyPath) try { tls.key = fs.readFileSync(opts.keyPath); } catch {}

    this.client = mqtt.connect(opts.url, {
      clientId: opts.clientId,
      username: opts.accessToken, // TB Device Access Token
      clean: opts.cleanSession ?? true,
      reconnectPeriod: 5000,
      keepalive: 15,
      rejectUnauthorized: opts.rejectUnauthorized ?? true,
      ...tls,
      will: {
        topic: 'v1/devices/me/telemetry',
        qos: 1,
        retain: false,
        payload: JSON.stringify({ ts: Date.now(), values: { status: 'offline' } })
      }
    });

    this.client.on('connect', (pkt) => {
      this.metrics.connects += 1;
      this.connected = true;
      this.lastError = null;
      this.lastDisconnectReasonCode = null;
      this.recordEvent('connect');
      logger.info({ msg: 'MQTT connected', clientId: opts.clientId, url: opts.url, sessionPresent: pkt.sessionPresent });
      const subscriptions = this.subs.map((s) => new Promise<void>((resolve) => {
        this.client.subscribe(s.topic, { qos: this.qos }, (err) => {
          if (err) logger.error({ msg: 'MQTT subscribe failed', topic: s.topic, err });
          resolve();
        });
      }));
      Promise.all(subscriptions)
        .then(async () => {
          await this.flushLoop();
          await this.publish('v1/devices/me/attributes', JSON.stringify({
            'edge.rpcReady': true,
            'edge.rpcReadyAt': Date.now()
          }), true);
          await this.publish('v1/devices/me/telemetry', JSON.stringify({ ts: Date.now(), values: { status: 'online', rpc_ready: true } }), true);
          for (const listener of this.connectListeners) {
            await listener();
          }
          (globalThis as any).lastMqttTs = Date.now();
        })
        .catch((err) => logger.error({ msg: 'MQTT reconnect setup failed', err }));
    });

    this.client.on('reconnect', () => {
      this.metrics.reconnects += 1;
      this.recordEvent('reconnect');
      logger.warn({ msg: 'MQTT reconnecting', clientId: opts.clientId, url: opts.url });
    });
    this.client.on('close', () => {
      this.metrics.closes += 1;
      this.connected = false;
      this.recordEvent('close');
      logger.warn({ msg: 'MQTT closed', clientId: opts.clientId, url: opts.url, lastPublishedTopic: this.lastPublishedTopic });
    });
    this.client.on('offline', () => {
      this.metrics.offlineEvents += 1;
      this.connected = false;
      this.recordEvent('offline');
      logger.warn({ msg: 'MQTT offline', clientId: opts.clientId, url: opts.url, lastPublishedTopic: this.lastPublishedTopic });
    });
    this.client.on('disconnect', (packet) => {
      this.connected = false;
      this.lastDisconnectReasonCode = packet.reasonCode ?? null;
      this.recordEvent('disconnect');
      logger.warn({ msg: 'MQTT disconnected by broker', clientId: opts.clientId, url: opts.url, reasonCode: packet.reasonCode, lastPublishedTopic: this.lastPublishedTopic });
    });
    this.client.on('error', (err) => {
      this.metrics.errors += 1;
      this.connected = false;
      this.lastError = err.message;
      this.recordEvent('error');
      logger.error({ msg: 'MQTT error', clientId: opts.clientId, url: opts.url, error: err.message, lastPublishedTopic: this.lastPublishedTopic });
    });

    this.client.on('message', (topic, payload) => {
      for (const s of this.subs) {
        if (topicMatches(s.topic, topic)) {
          try { s.handler(topic, payload); } catch (e) { logger.error({ msg: 'sub handler error', e }); }
        }
      }
    });

    this.timer = setInterval(() => this.flushLoop(), this.flushIntervalMs);
  }

  subscribe(topic: string, handler: Handler) {
    if (this.ended) return;
    this.subs.push({ topic, handler });
    this.client.subscribe(topic, { qos: this.qos });
  }

  onConnect(listener: () => void | Promise<void>) {
    if (this.ended) return;
    this.connectListeners.push(listener);
    if (this.connected) {
      Promise.resolve(listener()).catch((err) => logger.error({ msg: 'MQTT onConnect listener failed', err }));
    }
  }

  async publish(topic: string, payload: string, priority = false) {
    this.metrics.publishAttempts += 1;
    if (this.ended) {
      logger.warn({ msg: 'MQTT publish skipped after handler closed', topic });
      return;
    }
    const priorityFlag = !!priority;
    if (!this.connected) {
      if (isEphemeralTopic(topic)) {
        this.metrics.bufferedDroppedEphemeral += 1;
        logger.warn({ msg: 'Dropping MQTT publish because topic cannot be safely buffered', topic });
        return;
      }
      this.bufferMessage(topic, payload);
      return;
    }
    await new Promise<void>((resolve) => {
      this.lastPublishedTopic = topic;
      this.client.publish(topic, payload, { qos: this.qos }, (err) => {
        if (err) {
          this.metrics.publishFailures += 1;
          logger.error({ msg: 'publish failed, buffering', topic, err });
          if (!this.ended) this.bufferMessage(topic, payload);
        } else {
          this.metrics.publishSuccess += 1;
        }
        resolve();
      });
    });
    if (priorityFlag) await this.flushOnce();
  }

  private bufferMessage(topic: string, payload: string) {
    const result = this.store.add({ topic, payload, ts: Date.now() });
    this.metrics.bufferedAdded += 1;
    this.metrics.bufferedPurged += result.purged;
  }

  private async delay(ms: number) {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async flushOnce(batchSize = this.flushBatchSize) {
    if (this.ended || this.flushing || !this.connected) return;
    this.flushing = true;
    this.metrics.flushRuns += 1;
    const startedAt = Date.now();
    this.metrics.lastFlushStartedAt = startedAt;
    let published = 0;
    try {
      let batch: BufferedMessage[] = this.store.getBatch(batchSize);
      while (batch.length && this.connected && !this.ended) {
        await Promise.all(batch.map(m => new Promise<void>((res) => {
          if (isEphemeralTopic(m.topic)) {
            if (m.id && !this.ended) this.store.remove(m.id);
            this.metrics.bufferedDroppedEphemeral += 1;
            logger.warn({ msg: 'Dropping stale buffered MQTT message', topic: m.topic, id: m.id });
            res();
            return;
          }
          this.lastPublishedTopic = m.topic;
          this.client.publish(m.topic, m.payload, { qos: this.qos }, (err) => {
            if (!err && m.id && !this.ended) {
              this.store.remove(m.id);
              published += 1;
              this.metrics.bufferedFlushed += 1;
            }
            if (err) {
              this.metrics.flushFailures += 1;
              logger.error({ msg: 'flush publish failed, will retry later', id: m.id, err });
            }
            res();
          });
        })));
        if (this.flushDelayMs > 0 && this.connected && !this.ended) {
          await this.delay(this.flushDelayMs);
        }
        batch = this.store.getBatch(batchSize);
      }
      if (batch.length === 0) logger.info({
        msg: 'buffer flushed',
        published,
        flushBatchSize: this.flushBatchSize,
        flushDelayMs: this.flushDelayMs
      });
    } finally {
      const finishedAt = Date.now();
      const durationMs = Math.max(0, finishedAt - startedAt);
      this.metrics.lastFlushFinishedAt = finishedAt;
      this.metrics.lastFlushDurationMs = durationMs;
      this.metrics.lastFlushPublished = published;
      this.metrics.lastFlushRatePerSec = durationMs > 0 ? Math.round((published / durationMs) * 100000) / 100 : published;
      this.flushing = false;
    }
  }

  private async flushLoop() {
    if (this.ended || !this.connected) return;
    await this.flushOnce();
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.connected = false;
    if (this.timer) clearInterval(this.timer);
    this.subs = [];
    this.connectListeners = [];
    this.client.removeAllListeners();
    this.client.end(true);
    this.recordEvent('ended');
    logger.info({ msg: 'MQTT handler closed', clientId: this.clientId, url: this.url });
    this.store.close();
  }

  /** True when MQTT session is connected. */
  isConnected(): boolean {
    return this.connected;
  }

  /** Number of buffered publish messages persisted in sqlite. */
  getBufferedCount(): number {
    try {
      return this.store.count();
    } catch {
      return -1;
    }
  }

  getDiagnostics() {
    return {
      url: this.url,
      clientId: this.clientId,
      connected: this.connected,
      ended: this.ended,
      lastEvent: this.lastEvent,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError,
      lastDisconnectReasonCode: this.lastDisconnectReasonCode,
      lastPublishedTopic: this.lastPublishedTopic,
      buffered: this.getBufferedCount(),
      buffer: this.getBufferStats(),
      flushBatchSize: this.flushBatchSize,
      flushDelayMs: this.flushDelayMs,
      flushIntervalMs: this.flushIntervalMs,
      flushing: this.flushing,
      metrics: { ...this.metrics },
      replay: {
        configuredApproxMaxRatePerSec: this.flushDelayMs > 0
          ? Math.round((this.flushBatchSize / this.flushDelayMs) * 100000) / 100
          : null,
        lastFlushDurationMs: this.metrics.lastFlushDurationMs,
        lastFlushPublished: this.metrics.lastFlushPublished,
        lastFlushRatePerSec: this.metrics.lastFlushRatePerSec
      }
    };
  }

  getBufferStats() {
    try {
      return this.store.stats();
    } catch {
      return {
        count: -1,
        oldestTs: null,
        newestTs: null,
        oldestAgeMs: null,
        newestAgeMs: null,
        payloadBytes: 0
      };
    }
  }
}
