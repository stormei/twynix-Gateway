import {
  OPCUAClient,
  AttributeIds,
  TimestampsToReturn,
  DataType,
  BrowseDirection,
  ClientSubscription,
  MonitoringParametersOptions,
  MessageSecurityMode,
  NodeClass,
  SecurityPolicy
} from 'node-opcua';
import { ClientSidePublishEngine } from 'node-opcua-client';
import {
  TagSpec,
  EdgeConfig,
  OpcUaBrowseNode,
  DataTypeName,
  OpcUaDiscoveredVariable,
  OpcUaDiscoverVariablesResult
} from '../types.js';
import { logger } from '../logger.js';

type OnChange = (tag: TagSpec, value: any) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapOpcUaDataType(nodeIdText?: string): DataTypeName | undefined {
  switch (nodeIdText) {
    case 'ns=0;i=1':
      return 'Boolean';
    case 'ns=0;i=4':
      return 'Int16';
    case 'ns=0;i=5':
      return 'UInt16';
    case 'ns=0;i=6':
      return 'Int32';
    case 'ns=0;i=7':
      return 'UInt32';
    case 'ns=0;i=10':
      return 'Float';
    case 'ns=0;i=11':
      return 'Double';
    case 'ns=0;i=12':
      return 'String';
    default:
      return undefined;
  }
}

function mapNodeClassName(nodeClass: any): string {
  if (typeof nodeClass?.key === 'string' && nodeClass.key) {
    return nodeClass.key;
  }

  if (typeof nodeClass === 'number') {
    return NodeClass[nodeClass] || String(nodeClass);
  }

  if (typeof nodeClass?.value === 'number') {
    return NodeClass[nodeClass.value] || String(nodeClass.value);
  }

  if (typeof nodeClass?.toString === 'function') {
    const text = nodeClass.toString();
    if (text && text !== '[object Object]') {
      return text;
    }
  }

  return 'Unknown';
}

function statusCodeText(status: any): string {
  if (!status) return '';
  if (typeof status === 'string') return status;
  if (typeof status?.name === 'string') return status.name;
  if (typeof status?.description === 'string') return status.description;
  if (typeof status?.toString === 'function') return status.toString();
  return String(status);
}

function waitForSubscriptionStarted(subscription: ClientSubscription, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subscription.off('started', onStarted);
      subscription.off('error', onError);
      subscription.off('terminated', onTerminated);
      error ? reject(error) : resolve();
    };
    const onStarted = () => finish();
    const onError = (error: any) => finish(error instanceof Error ? error : new Error(String(error)));
    const onTerminated = () => finish(new Error('OPC UA subscription terminated before start'));
    const timer = setTimeout(() => finish(new Error(`OPC UA subscription start timed out after ${timeoutMs}ms`)), timeoutMs);

    subscription.once('started', onStarted);
    subscription.once('error', onError);
    subscription.once('terminated', onTerminated);
  });
}

export class OpcUaClient {
  private client!: OPCUAClient;
  private session: any;
  private subscription?: ClientSubscription;
  private lastError?: string;

  private closing = false;
  private connectInFlight?: Promise<void>;
  private reconnectTimer?: NodeJS.Timeout;
  private resubscribeTimer?: NodeJS.Timeout;
  private resubscribeStableTimer?: NodeJS.Timeout;
  private subscriptionSetup?: Promise<void>;
  private readonly intentionalTerminations = new WeakSet<ClientSubscription>();
  private reconnectDelayMs = 1000;
  private resubscribeDelayMs = 1000;
  private readonly reconnectDelayMaxMs = 30_000;
  private reconnectCount = 0;
  private resubscribeCount = 0;
  private subscriptionGeneration = 0;
  private subscriptionState: 'idle' | 'starting' | 'ready' | 'terminated' | 'error' = 'idle';
  private lastSubscriptionEvent = 'idle';
  private lastSubscriptionEventTs = Date.now();

  // Last desired subscription so we can re-establish after reconnect
  private desiredTags: TagSpec[] = [];
  private desiredSamplingMs = 1000;
  private desiredOnChange?: OnChange;

  constructor(private cfg: EdgeConfig['opcua']) {}

  /**
   * Connects (with retry) and establishes an OPC UA session.
   * Safe to call multiple times.
   */
  async connect() {
    await this.ensureConnected();
  }

  private buildClientOptions(): any {
    ClientSidePublishEngine.publishRequestCountInPipeline = Math.max(1, Math.min(10, Number(this.cfg.publishRequestPipeline || 1)));
    const opts: any = {
      endpointMustExist: false,
      keepAliveInterval: 5000
    };
    if (this.cfg.applicationUri) {
      opts.applicationUri = this.cfg.applicationUri;
    }

    // If securityPolicy is set, use it; else default to None
    if (this.cfg.securityPolicy && this.cfg.securityPolicy !== 'None') {
      // NOTE: you can expand mapping here if you want multiple policies.
      opts.securityPolicy = SecurityPolicy.Basic256Sha256;
      opts.securityMode =
        this.cfg.securityMode === 'SignAndEncrypt'
          ? MessageSecurityMode.SignAndEncrypt
          : this.cfg.securityMode === 'Sign'
            ? MessageSecurityMode.Sign
            : MessageSecurityMode.None;

      if (this.cfg.certificateFile && this.cfg.privateKeyFile) {
        opts.certificateFile = this.cfg.certificateFile;
        opts.privateKeyFile = this.cfg.privateKeyFile;
      }
    }

    return opts;
  }

  private async ensureConnected(): Promise<void> {
    if (this.closing) throw new Error('OPC UA client is closing');

    // Already connected
    if (this.session) {
      if (this.isSessionUsable()) return;
      logger.warn({ msg: 'OPCUA session exists but channel is not usable; reconnecting' });
      await this.safeCloseInternal();
    }

    // Someone else is already connecting
    if (this.connectInFlight) {
      await this.connectInFlight;
      return;
    }

    this.connectInFlight = (async () => {
      let attempt = 0;
      while (!this.closing && !this.session) {
        attempt += 1;
        try {
          logger.info({ msg: 'OPCUA connecting', url: this.cfg.url, attempt });

          this.client = OPCUAClient.create(this.buildClientOptions());

          // Helpful logs during backoff
          (this.client as any).on?.('backoff', (retryCount: number, delay: number) => {
            logger.warn({ msg: 'OPCUA backoff', retryCount, delay });
          });

          await this.client.connect(this.cfg.url);

          const username = String(this.cfg.username || '').trim();
          const password = String(this.cfg.password || '');
          this.session = username || password
            ? await this.client.createSession({ userName: username || undefined, password: password || undefined } as any)
            : await this.client.createSession();

          logger.info({ msg: 'OPCUA connected' });
          this.lastError = undefined;

          // Reset reconnect delay on success
          this.reconnectDelayMs = 1000;

          return;
        } catch (e: any) {
          // Clean up partially connected state
          this.lastError = String(e?.message || e);
          logger.error({ msg: 'OPCUA connect failed', error: e?.message || e, attempt });
          await this.safeCloseInternal();

          // Retry with exponential backoff
          const wait = Math.min(this.reconnectDelayMaxMs, this.reconnectDelayMs);
          this.reconnectDelayMs = Math.min(this.reconnectDelayMaxMs, this.reconnectDelayMs * 2);
          await sleep(wait);
        }
      }
    })();

    try {
      await this.connectInFlight;
    } finally {
      this.connectInFlight = undefined;
    }
  }

  /**
   * Subscribe to a set of tags. Stores subscription intent and will
   * automatically resubscribe after reconnect.
   */
  async subscribe(tags: TagSpec[], samplingMs: number, onChange: (tag: TagSpec, value: any) => void) {
    this.desiredTags = tags;
    this.desiredSamplingMs = samplingMs;
    this.desiredOnChange = onChange;

    await this.ensureConnected();
    await this.setupSubscription(tags, samplingMs, onChange);
  }

  private async setupSubscription(tags: TagSpec[], samplingMs: number, onChange: OnChange) {
    const previous = this.subscriptionSetup || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.setupSubscriptionInternal(tags, samplingMs, onChange));
    this.subscriptionSetup = next;
    try {
      await next;
    } finally {
      if (this.subscriptionSetup === next) this.subscriptionSetup = undefined;
    }
  }

  private isSessionUsable(): boolean {
    return !!this.session && !this.session._closed && this.session.isChannelValid?.() !== false;
  }

  private isFatalChannelError(error: any): boolean {
    const text = String(error?.message || error || '');
    return /Connection Break|BadConnectionClosed|Invalid Channel|secure channel|channel/i.test(text);
  }

  private async setupSubscriptionInternal(tags: TagSpec[], samplingMs: number, onChange: OnChange) {
    if (!this.session) throw new Error('OPC UA session not initialized');
    if (!this.isSessionUsable()) throw new Error('OPC UA session channel is not usable');

    // Tear down any existing subscription to avoid double-monitoring
    try {
      if (this.subscription) {
        const oldSubscription = this.subscription;
        this.intentionalTerminations.add(oldSubscription);
        this.subscription = undefined;
        await oldSubscription.terminate();
      }
    } catch {
      // ignore
    }

    const generation = ++this.subscriptionGeneration;
    const subscription = ClientSubscription.create(this.session, {
      requestedPublishingInterval: this.cfg.publishingIntervalMs || Math.max(1000, samplingMs),
      requestedLifetimeCount: this.cfg.lifetimeCount || 60,
      requestedMaxKeepAliveCount: this.cfg.maxKeepAliveCount || 5,
      maxNotificationsPerPublish: this.cfg.maxNotificationsPerPublish || 100,
      publishingEnabled: true,
      priority: 10
    });
    this.subscription = subscription;
    this.setSubscriptionState('starting', 'subscription_starting');

    subscription.on('started', (subscriptionId: number) => {
      this.setSubscriptionState('ready', 'subscription_started');
      logger.info({
        msg: 'OPCUA subscription started',
        subscriptionId,
        generation,
        publishingIntervalMs: subscription.publishingInterval,
        lifetimeCount: subscription.lifetimeCount,
        maxKeepAliveCount: subscription.maxKeepAliveCount,
        maxNotificationsPerPublish: subscription.maxNotificationsPerPublish,
        timeoutHint: (subscription as any)?.timeoutHint,
        remainingLifetimeMs: typeof (subscription as any)?.evaluateRemainingLifetime === 'function'
          ? (subscription as any).evaluateRemainingLifetime()
          : undefined
      });
    });
    subscription.on('keepalive', () => {
      this.setSubscriptionState('ready', 'subscription_keepalive');
      logger.debug({ msg: 'OPCUA subscription keepalive', subscriptionId: subscription.subscriptionId, generation });
    });
    subscription.on('status_changed', (status: any, diagnosticInfo: any) => {
      logger.warn({
        msg: 'OPCUA subscription status changed',
        subscriptionId: subscription.subscriptionId,
        generation,
        status: statusCodeText(status),
        diagnosticInfo: diagnosticInfo ? String(diagnosticInfo) : undefined
      });
    });
    subscription.on('internal_error', (error: any) => {
      this.setSubscriptionState('error', 'subscription_internal_error');
      logger.error({ msg: 'OPCUA subscription internal error', error: error?.message || String(error) });
      if (!this.closing && this.isFatalChannelError(error)) {
        if (this.subscription === subscription) this.subscription = undefined;
        this.session = undefined;
        this.scheduleReconnect('subscription_channel_error');
      }
    });
    subscription.on('error', (error: any) => {
      this.setSubscriptionState('error', 'subscription_error');
      logger.error({ msg: 'OPCUA subscription error', error: error?.message || String(error) });
      if (!this.closing && this.isFatalChannelError(error)) {
        if (this.subscription === subscription) this.subscription = undefined;
        this.session = undefined;
        this.scheduleReconnect('subscription_channel_error');
      }
    });
    subscription.on('terminated', () => {
      const terminated = subscription as any;
      const intentional = this.intentionalTerminations.has(subscription);
      const obsolete = this.subscription !== subscription;
      logger.warn({
        msg: 'OPCUA subscription terminated',
        subscriptionId: terminated?.subscriptionId,
        generation,
        currentGeneration: this.subscriptionGeneration,
        intentional,
        obsolete,
        hasTimedOut: terminated?.hasTimedOut,
        publishingIntervalMs: terminated?.publishingInterval,
        lifetimeCount: terminated?.lifetimeCount,
        maxKeepAliveCount: terminated?.maxKeepAliveCount,
        remainingLifetimeMs: typeof terminated?.evaluateRemainingLifetime === 'function'
          ? terminated.evaluateRemainingLifetime()
          : undefined
      });
      if (this.closing || intentional || obsolete) return;
      this.setSubscriptionState('terminated', 'subscription_terminated');
      if (this.subscription === subscription) this.subscription = undefined;
      this.scheduleResubscribe('subscription_terminated');
    });

    await waitForSubscriptionStarted(subscription);

    for (const t of tags) {
      if (this.subscription !== subscription || (subscription as any).isActive === false) {
        throw new Error('OPC UA subscription terminated while adding monitored items');
      }
      if (!this.isSessionUsable()) {
        throw new Error('OPC UA session channel closed while adding monitored items');
      }
      const item = await subscription.monitor(
        { nodeId: t.nodeId, attributeId: AttributeIds.Value } as any,
        { samplingInterval: samplingMs, queueSize: this.cfg.monitoredItemQueueSize || 10, discardOldest: true } as MonitoringParametersOptions,
        TimestampsToReturn.Both
      );

      item.on('changed', (d: any) => {
        const v = d?.value?.value;
        try {
          onChange(t, v);
        } catch (e) {
          logger.error({ msg: 'OPCUA onChange handler error', key: t.key, e });
        }
      });
    }

    logger.info({
      msg: 'OPCUA subscription ready',
      subscriptionId: subscription.subscriptionId,
      generation,
      tags: tags.length,
      samplingMs,
      publishingIntervalMs: this.cfg.publishingIntervalMs || Math.max(1000, samplingMs),
      lifetimeCount: this.cfg.lifetimeCount || 60,
      maxKeepAliveCount: this.cfg.maxKeepAliveCount || 5,
      maxNotificationsPerPublish: this.cfg.maxNotificationsPerPublish || 100,
      monitoredItemQueueSize: this.cfg.monitoredItemQueueSize || 10,
      publishRequestPipeline: this.cfg.publishRequestPipeline || 1
    });
    this.setSubscriptionState('ready', 'subscription_ready');
    if (this.resubscribeStableTimer) clearTimeout(this.resubscribeStableTimer);
    this.resubscribeStableTimer = setTimeout(() => {
      this.resubscribeDelayMs = 1000;
      this.resubscribeStableTimer = undefined;
    }, Math.max(60_000, (this.cfg.publishingIntervalMs || Math.max(1000, samplingMs)) * 10));
  }

  private coerceToType(value: any, type: TagSpec['type']): { dataType: DataType; value: any } {
    switch (type) {
      case 'Boolean':
        return { dataType: DataType.Boolean, value: Boolean(value) };
      case 'Int16':
        return { dataType: DataType.Int16, value: Number(value) };
      case 'UInt16':
        return { dataType: DataType.UInt16, value: Number(value) };
      case 'Int32':
        return { dataType: DataType.Int32, value: Number(value) };
      case 'UInt32':
        return { dataType: DataType.UInt32, value: Number(value) };
      case 'Float':
        return { dataType: DataType.Float, value: Number(value) };
      case 'Double':
        return { dataType: DataType.Double, value: Number(value) };
      case 'String':
        return { dataType: DataType.String, value: String(value) };
    }
  }

  async write(tag: TagSpec, value: any) {
    await this.ensureConnected();
    if (!this.session) throw new Error('OPC UA session not initialized');
    if (!tag.write?.enabled) throw new Error(`Tag ${tag.key} is not write-enabled`);

    const v = this.coerceToType(value, tag.type);

    if (typeof tag.min === 'number' && Number(value) < tag.min) throw new Error(`Below min ${tag.min}`);
    if (typeof tag.max === 'number' && Number(value) > tag.max) throw new Error(`Above max ${tag.max}`);

    const nodesToWrite = [
      {
        nodeId: tag.nodeId,
        attributeId: AttributeIds.Value,
        value: { value: v }
      }
    ];

    try {
      const results = await this.session.write(nodesToWrite);

      const result = Array.isArray(results) ? results[0] : results;
      const status = (result as any)?.statusCode ?? result;

      logger.info({
        msg: 'Raw OPC UA write result',
        key: tag.key,
        nodeId: tag.nodeId,
        raw: JSON.stringify(results)
      });

      const statusName =
        typeof status?.name === 'string'
          ? status.name
          : typeof status?.toString === 'function'
            ? status.toString()
            : 'Unknown';

      logger.info({
        msg: 'OPC UA server write',
        key: tag.key,
        nodeId: tag.nodeId,
        type: tag.type,
        value: v?.value,
        status: statusName
      });

      if (!status || statusName !== 'Good') {
        throw new Error(`OPCUA write failed: ${statusName}`);
      }

      return result;
    } catch (e: any) {
      logger.error({
        msg: 'OPC UA write exception',
        nodeId: tag.nodeId,
        error: e?.message || e
      });
      // Writes often fail when session is broken; attempt reconnect
      this.scheduleReconnect('write_failed');
      throw e;
    }
  }

  async read(tag: TagSpec): Promise<any> {
    await this.ensureConnected();
    if (!this.session) throw new Error('OPC UA session not initialized');

    try {
      const dv = await this.session.read({ nodeId: tag.nodeId, attributeId: AttributeIds.Value });
      return dv?.value?.value;
    } catch (e: any) {
      logger.error({ msg: 'OPCUA read error', nodeId: tag.nodeId, error: e?.message || e });
      this.scheduleReconnect('read_failed');
      throw e;
    }
  }

  async browse(nodeId = 'RootFolder'): Promise<OpcUaBrowseNode[]> {
    await this.ensureConnected();
    if (!this.session) throw new Error('OPC UA session not initialized');

    try {
      const browseResult = await this.session.browse({
        nodeId,
        browseDirection: BrowseDirection.Forward,
        includeSubtypes: true,
        resultMask: 63
      });

      const refs = Array.isArray(browseResult.references) ? browseResult.references : [];
      if (refs.length === 0) return [];

      const nodeIds = refs.map((ref: any) => ref.nodeId);
      const attributeReads = await this.session.read(
        nodeIds.flatMap((refNodeId: any) => [
          { nodeId: refNodeId, attributeId: AttributeIds.DataType },
          { nodeId: refNodeId, attributeId: AttributeIds.UserAccessLevel }
        ])
      );

      return refs.map((ref: any, index: number) => {
        const dataTypeValue = attributeReads[index * 2]?.value?.value;
        const accessLevelValue = Number(attributeReads[index * 2 + 1]?.value?.value ?? 0);
        const dataTypeNodeId =
          dataTypeValue && typeof dataTypeValue.toString === 'function'
            ? dataTypeValue.toString()
            : undefined;
        const nodeClass = mapNodeClassName(ref.nodeClass);
        const hasChildren =
          nodeClass === 'Object' ||
          nodeClass === 'Variable' ||
          nodeClass === 'View' ||
          nodeClass === 'ObjectType' ||
          nodeClass === 'VariableType';

        return {
          nodeId: typeof ref.nodeId?.toString === 'function' ? ref.nodeId.toString() : String(ref.nodeId),
          browseName:
            typeof ref.browseName?.name === 'string'
              ? ref.browseName.name
              : typeof ref.browseName?.toString === 'function'
                ? ref.browseName.toString()
                : '',
          displayName:
            typeof ref.displayName?.text === 'string' && ref.displayName.text
              ? ref.displayName.text
              : typeof ref.browseName?.name === 'string'
                ? ref.browseName.name
                : typeof ref.nodeId?.toString === 'function'
                  ? ref.nodeId.toString()
                  : String(ref.nodeId),
          nodeClass,
          hasChildren,
          dataType: mapOpcUaDataType(dataTypeNodeId),
          writable: (accessLevelValue & 0x02) === 0x02
        } satisfies OpcUaBrowseNode;
      });
    } catch (e: any) {
      logger.error({ msg: 'OPCUA browse error', nodeId, error: e?.message || e });
      this.scheduleReconnect('browse_failed');
      throw e;
    }
  }

  async discoverVariables(
    rootNodeId = 'RootFolder',
    opts?: { maxDepth?: number; maxNodes?: number; timeoutMs?: number }
  ): Promise<OpcUaDiscoverVariablesResult> {
    const maxDepth = Math.max(0, Math.min(20, Number(opts?.maxDepth ?? 6)));
    const maxNodes = Math.max(1, Math.min(10000, Number(opts?.maxNodes ?? 1000)));
    const timeoutMs = Math.max(1000, Math.min(120000, Number(opts?.timeoutMs ?? 15000)));
    const startedAt = Date.now();
    const visited = new Set<string>();
    const variables: OpcUaDiscoveredVariable[] = [];
    let scannedNodes = 0;
    let truncated = false;

    const walk = async (nodeId: string, depth: number, browsePath: string): Promise<void> => {
      if (truncated) return;
      if (Date.now() - startedAt > timeoutMs) {
        truncated = true;
        return;
      }
      if (depth > maxDepth) return;
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const children = await this.browse(nodeId);
      for (const child of children) {
        if (scannedNodes >= maxNodes) {
          truncated = true;
          return;
        }
        scannedNodes += 1;
        const childName = child.displayName || child.browseName || child.nodeId;
        const childPath = browsePath ? `${browsePath}/${childName}` : childName;
        const isVariable = child.nodeClass === 'Variable' && !!child.dataType;

        if (isVariable) {
          variables.push({
            nodeId: child.nodeId,
            browsePath: childPath,
            displayName: childName,
            dataType: child.dataType,
            writable: child.writable
          });
        }

        if (child.hasChildren && depth < maxDepth) {
          await walk(child.nodeId, depth + 1, childPath);
          if (truncated) return;
        }
      }
    };

    try {
      await walk(rootNodeId, 0, '');
      return {
        ok: true,
        rootNodeId,
        variables,
        truncated,
        scannedNodes,
        maxDepth,
        maxNodes
      };
    } catch (e: any) {
      logger.error({ msg: 'OPCUA discover variables error', rootNodeId, error: e?.message || e });
      throw e;
    }
  }

  private scheduleReconnect(reason: string) {
    if (this.closing) return;
    if (this.reconnectTimer) return;
    if (this.resubscribeTimer) {
      clearTimeout(this.resubscribeTimer);
      this.resubscribeTimer = undefined;
    }
    if (this.resubscribeStableTimer) {
      clearTimeout(this.resubscribeStableTimer);
      this.resubscribeStableTimer = undefined;
    }

    const delay = Math.min(this.reconnectDelayMaxMs, this.reconnectDelayMs);
    this.reconnectCount += 1;
    logger.warn({ msg: 'OPCUA scheduling reconnect', reason, delayMs: delay });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;

      try {
        await this.safeCloseInternal();
        await this.ensureConnected();
        if (this.desiredTags.length && this.desiredOnChange) {
          await this.setupSubscription(this.desiredTags, this.desiredSamplingMs, this.desiredOnChange);
        }
      } catch (e: any) {
        logger.error({ msg: 'OPCUA reconnect attempt failed', error: e?.message || e });
        // If this still fails, ensureConnected will retry with its backoff.
      }
    }, delay);

    this.reconnectDelayMs = Math.min(this.reconnectDelayMaxMs, this.reconnectDelayMs * 2);
  }

  private scheduleResubscribe(reason: string) {
    if (this.closing) return;
    if (!this.desiredTags.length || !this.desiredOnChange) return;
    if (this.resubscribeTimer || this.reconnectTimer) return;

    const delay = Math.min(this.reconnectDelayMaxMs, this.resubscribeDelayMs);
    this.resubscribeCount += 1;
    logger.warn({ msg: 'OPCUA scheduling resubscribe', reason, delayMs: delay });

    this.resubscribeTimer = setTimeout(async () => {
      this.resubscribeTimer = undefined;

      try {
        if (!this.session) {
          this.scheduleReconnect('resubscribe_without_session');
          return;
        }
        await this.setupSubscription(this.desiredTags, this.desiredSamplingMs, this.desiredOnChange!);
      } catch (e: any) {
        logger.error({ msg: 'OPCUA resubscribe failed', error: e?.message || e });
        this.scheduleReconnect('resubscribe_failed');
      }
    }, delay);

    this.resubscribeDelayMs = Math.min(this.reconnectDelayMaxMs, this.resubscribeDelayMs * 2);
  }

  private async safeCloseInternal() {
    if (this.resubscribeTimer) {
      clearTimeout(this.resubscribeTimer);
      this.resubscribeTimer = undefined;
    }
    if (this.resubscribeStableTimer) {
      clearTimeout(this.resubscribeStableTimer);
      this.resubscribeStableTimer = undefined;
    }
    try {
      if (this.subscription) {
        const oldSubscription = this.subscription;
        this.intentionalTerminations.add(oldSubscription);
        this.subscription = undefined;
        await oldSubscription.terminate();
      }
    } catch {
      // ignore
    }
    this.subscription = undefined;

    try {
      if (this.session) await this.session.close();
    } catch {
      // ignore
    }
    this.session = undefined;

    try {
      if (this.client) await this.client.disconnect();
    } catch {
      // ignore
    }
  }

  async close() {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.resubscribeTimer) clearTimeout(this.resubscribeTimer);
    if (this.resubscribeStableTimer) clearTimeout(this.resubscribeStableTimer);
    await this.safeCloseInternal();
  }

  /** True when we currently have a session. */
  isConnected(): boolean {
    return !!this.session;
  }

  /** True when the session and secure channel are usable for requests. */
  isUsable(): boolean {
    return this.isSessionUsable();
  }

  /** True when subscription exists (may still be reconnecting). */
  hasActiveSubscription(): boolean {
    return !!this.subscription && this.subscriptionState === 'ready';
  }

  /** Last connection error message, if any. */
  getLastError(): string | undefined {
    return this.lastError;
  }

  getDiagnostics() {
    return {
      connected: this.isConnected(),
      usable: this.isUsable(),
      subscriptionReady: this.hasActiveSubscription(),
      subscriptionState: this.subscriptionState,
      subscriptionId: this.subscription?.subscriptionId,
      subscriptionGeneration: this.subscriptionGeneration,
      lastSubscriptionEvent: this.lastSubscriptionEvent,
      lastSubscriptionEventTs: this.lastSubscriptionEventTs,
      reconnectCount: this.reconnectCount,
      resubscribeCount: this.resubscribeCount,
      desiredTagCount: this.desiredTags.length,
      lastError: this.lastError
    };
  }

  private setSubscriptionState(
    state: 'idle' | 'starting' | 'ready' | 'terminated' | 'error',
    event: string
  ) {
    this.subscriptionState = state;
    this.lastSubscriptionEvent = event;
    this.lastSubscriptionEventTs = Date.now();
  }
}
