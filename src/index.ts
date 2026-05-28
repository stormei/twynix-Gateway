import crypto from 'crypto';
import http from 'http';
import fs from 'fs-extra';
import path from 'path';
import { CONFIG_PATH, loadConfig } from './config.js';
import {
  createLocalConfigBackup,
  extractThingsBoardConfigBackup,
  listLocalConfigBackups,
  normalizeConfigBackupEnvelope,
  readLocalConfigBackup,
  thingsBoardConfigBackupAttributes
} from './configBackup.js';
import { normalizeMapping } from './mapping.js';
import { renderAdminUi } from './adminUi.js';
import { readJsonBody, sendHtml, sendJson, sendText, parseCookies } from './httpServer.js';
import { getLogCapabilities, getRecentLogs, logger, setRuntimeLogLevel } from './logger.js';
import { GatewayRuntimeManager, mergeConfig } from './runtime/GatewayRuntime.js';
import { configVersion, sanitizedConfigSummary } from './status.js';
import { DataTypeName, EdgeConfig } from './types.js';
import { versionInfo } from './version.js';

type SessionRecord = {
  username: string;
  expiresAt: number;
};

type LoginAttemptRecord = {
  count: number;
  blockedUntil: number;
};

type AdminCredentials = {
  username: string;
  passwordHash: string | null;
  legacyPassword: string | null;
};

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function slugifyKey(value: string): string {
  const compact = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return compact || `tag_${Date.now()}`;
}

function hashAdminPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyAdminPassword(password: string, passwordHash: string): boolean {
  const [scheme, salt, derived] = passwordHash.split('$');
  if (scheme !== 'scrypt' || !salt || !derived) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(derived, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

async function persistAdminPasswordHash(passwordHash: string) {
  const hashFile = process.env.ADMIN_PASSWORD_HASH_FILE;
  if (hashFile) {
    await fs.ensureDir(path.dirname(path.resolve(hashFile)));
    await fs.writeFile(hashFile, passwordHash + '\n', { encoding: 'utf8', mode: 0o600 });
    return;
  }

  const envPath = path.resolve('.env');
  const current = (await fs.pathExists(envPath)) ? await fs.readFile(envPath, 'utf8') : '';
  const filteredLines = current
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('ADMIN_PASSWORD=') && !line.startsWith('ADMIN_PASSWORD_HASH='));
  while (filteredLines.length > 0 && filteredLines[filteredLines.length - 1] === '') {
    filteredLines.pop();
  }
  filteredLines.push(`ADMIN_PASSWORD_HASH=${passwordHash}`);
  await fs.writeFile(envPath, filteredLines.join('\n') + '\n', 'utf8');
}

async function main() {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPasswordHashFile = process.env.ADMIN_PASSWORD_HASH_FILE;
  const adminPasswordHashFromFile = adminPasswordHashFile && await fs.pathExists(adminPasswordHashFile)
    ? (await fs.readFile(adminPasswordHashFile, 'utf8')).trim()
    : '';
  const adminPasswordHash = adminPasswordHashFromFile || process.env.ADMIN_PASSWORD_HASH || null;
  const adminPassword = process.env.ADMIN_PASSWORD || null;
  if (!adminUsername || (!adminPasswordHash && !adminPassword)) {
    throw new Error('ADMIN_USERNAME and either ADMIN_PASSWORD_HASH or ADMIN_PASSWORD must be configured');
  }
  const adminCredentials: AdminCredentials = {
    username: adminUsername,
    passwordHash: adminPasswordHash,
    legacyPassword: adminPassword
  };
  const port = Number(process.env.HEALTH_PORT || 8080);
  const secureCookies = process.env.ADMIN_COOKIE_SECURE === 'true';
  const sessionTtlMs = 1000 * 60 * 60 * 12;
  const sessions = new Map<string, SessionRecord>();
  const loginAttempts = new Map<string, LoginAttemptRecord>();
  const maxLoginAttempts = 5;
  const loginBlockMs = 15 * 60 * 1000;

  const runtimeManager = new GatewayRuntimeManager(await loadConfig());
  const version = versionInfo();
  let savedConfigReconcileInFlight = false;
  let savedConfigReconcileTimer: NodeJS.Timeout | undefined;

  (globalThis as any).lastMqttTs = Date.now();
  (globalThis as any).lastOpcTs = Date.now();
  const getStatusPayload = () => runtimeManager.getStatusPayload();
  const getDebugPayload = (url: URL) => {
    const snapshot = getStatusPayload();
    return {
      ok: snapshot.ok,
      ts: Date.now(),
      version,
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptimeSec: Math.round(process.uptime()),
        memory: process.memoryUsage(),
        cwd: process.cwd(),
        env: {
          nodeEnv: process.env.NODE_ENV || '',
          healthPort: process.env.HEALTH_PORT || '',
          configPath: process.env.CONFIG_PATH || CONFIG_PATH,
          logLevel: process.env.LOG_LEVEL || ''
        }
      },
      paths: {
        configPath: CONFIG_PATH,
        logs: getLogCapabilities()
      },
      status: snapshot,
      config: sanitizedConfigSummary(runtimeManager.config),
      logs: getRecentLogs({
        limit: Number(url.searchParams.get('limit') || 200),
        level: url.searchParams.get('level') || undefined,
        q: url.searchParams.get('q') || undefined
      })
    };
  };

  const createSession = (username: string) => {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { username, expiresAt: Date.now() + sessionTtlMs });
    return token;
  };

  const getClientAddress = (req: http.IncomingMessage) => {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0]!.trim();
    }
    return req.socket.remoteAddress || 'unknown';
  };

  const getAuthenticatedUser = (req: http.IncomingMessage) => {
    const cookies = parseCookies(req);
    const token = cookies.gateway_admin_session;
    if (!token) return null;

    const session = sessions.get(token);
    if (!session) return null;

    if (session.expiresAt < Date.now()) {
      sessions.delete(token);
      return null;
    }

    session.expiresAt = Date.now() + sessionTtlMs;
    return session.username;
  };

  const getCurrentSessionToken = (req: http.IncomingMessage) => {
    return parseCookies(req).gateway_admin_session || null;
  };

  const isValidAdminPassword = (password: string) => {
    if (adminCredentials.passwordHash) {
      return verifyAdminPassword(password, adminCredentials.passwordHash);
    }
    return adminCredentials.legacyPassword ? safeEqual(password, adminCredentials.legacyPassword) : false;
  };

  const clearSession = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const token = parseCookies(req).gateway_admin_session;
    if (token) sessions.delete(token);
    res.setHeader(
      'Set-Cookie',
      `gateway_admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? '; Secure' : ''}`
    );
  };

  const requireAuth = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const username = getAuthenticatedUser(req);
    if (!username) {
      sendJson(res, 401, { error: 'Authentication required' });
      return null;
    }
    return username;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method || 'GET';
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (method === 'GET' && pathname === '/healthz') {
        const snapshot = getStatusPayload();
        sendJson(res, snapshot.ok ? 200 : 503, snapshot);
        return;
      }

      if (method === 'GET' && pathname === '/readyz') {
        sendText(res, 200, 'ready');
        return;
      }

      if (method === 'GET' && pathname === '/metrics') {
        const snapshot = getStatusPayload();
        sendText(
          res,
          200,
          'edge_gateway_up 1\n' +
            `edge_gateway_mqtt_connected ${snapshot.mqtt.connected ? 1 : 0}\n` +
            `edge_gateway_mqtt_buffered ${snapshot.mqtt.buffered}\n` +
            `edge_gateway_opcua_connected ${snapshot.opcua.connected ? 1 : 0}\n` +
            `edge_gateway_rpc_pending_total ${snapshot.rpc.pendingTotal}\n`
        );
        return;
      }

      if (method === 'GET' && pathname === '/api/session') {
        const username = getAuthenticatedUser(req);
        sendJson(res, 200, { authenticated: !!username, username: username || null, version });
        return;
      }

      if (method === 'POST' && pathname === '/api/login') {
        const clientAddress = getClientAddress(req);
        const currentAttempt = loginAttempts.get(clientAddress);
        if (currentAttempt && currentAttempt.blockedUntil > Date.now()) {
          sendJson(res, 429, { error: 'Too many failed login attempts. Try again later.' });
          return;
        }

        const body = await readJsonBody(req);
        const username = String(body.username || '');
        const password = String(body.password || '');

        const validUsername = safeEqual(username, adminCredentials.username);
        const validPassword = isValidAdminPassword(password);

        if (!validUsername || !validPassword) {
          const failures = (currentAttempt?.count || 0) + 1;
          loginAttempts.set(clientAddress, {
            count: failures,
            blockedUntil: failures >= maxLoginAttempts ? Date.now() + loginBlockMs : 0
          });
          sendJson(res, 401, { error: 'Invalid username or password' });
          return;
        }

        loginAttempts.delete(clientAddress);
        const token = createSession(username);
        res.setHeader(
          'Set-Cookie',
          `gateway_admin_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${
            sessionTtlMs / 1000
          }${secureCookies ? '; Secure' : ''}`
        );
        sendJson(res, 200, { ok: true, username });
        return;
      }

      if (method === 'POST' && pathname === '/api/admin/password') {
        const username = requireAuth(req, res);
        if (!username) return;

        const body = await readJsonBody(req);
        const currentPassword = String(body.currentPassword || '');
        const newPassword = String(body.newPassword || '');
        const confirmPassword = String(body.confirmPassword || '');

        if (!isValidAdminPassword(currentPassword)) {
          sendJson(res, 401, { error: 'Current password is incorrect' });
          return;
        }
        if (newPassword.length < 12) {
          sendJson(res, 400, { error: 'New password must be at least 12 characters' });
          return;
        }
        if (newPassword !== confirmPassword) {
          sendJson(res, 400, { error: 'New password confirmation does not match' });
          return;
        }
        if (isValidAdminPassword(newPassword)) {
          sendJson(res, 400, { error: 'New password must be different from the current password' });
          return;
        }

        const nextPasswordHash = hashAdminPassword(newPassword);
        await persistAdminPasswordHash(nextPasswordHash);
        adminCredentials.passwordHash = nextPasswordHash;
        adminCredentials.legacyPassword = null;
        process.env.ADMIN_PASSWORD_HASH = nextPasswordHash;
        delete process.env.ADMIN_PASSWORD;

        const currentToken = getCurrentSessionToken(req);
        for (const token of Array.from(sessions.keys())) {
          if (token !== currentToken) {
            sessions.delete(token);
          }
        }

        logger.info({ msg: 'Admin password updated', username });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && pathname === '/api/logout') {
        clearSession(req, res);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && pathname === '/api/status') {
        if (!requireAuth(req, res)) return;
        sendJson(res, 200, getStatusPayload());
        return;
      }

      if (method === 'GET' && pathname === '/api/logs') {
        if (!requireAuth(req, res)) return;
        sendJson(res, 200, {
          capabilities: getLogCapabilities(),
          logs: getRecentLogs({
            limit: Number(url.searchParams.get('limit') || 200),
            level: url.searchParams.get('level') || undefined,
            q: url.searchParams.get('q') || undefined
          })
        });
        return;
      }

      if (method === 'GET' && pathname === '/api/debug') {
        if (!requireAuth(req, res)) return;
        sendJson(res, 200, getDebugPayload(url));
        return;
      }

      if (method === 'POST' && pathname === '/api/log-level') {
        if (!requireAuth(req, res)) return;
        const body = await readJsonBody(req);
        const capabilities = setRuntimeLogLevel(String(body.level || '').trim());
        logger.info({ msg: 'Runtime log level changed from admin UI', level: capabilities.currentLevel });
        sendJson(res, 200, capabilities);
        return;
      }

      if (method === 'GET' && pathname === '/api/config') {
        if (!requireAuth(req, res)) return;
        sendJson(res, 200, runtimeManager.config);
        return;
      }

      if (method === 'GET' && pathname === '/api/config/backups') {
        if (!requireAuth(req, res)) return;
        sendJson(res, 200, {
          backupDir: process.env.CONFIG_BACKUP_DIR || path.join(path.dirname(CONFIG_PATH), 'backups'),
          local: await listLocalConfigBackups()
        });
        return;
      }

      if (method === 'POST' && pathname === '/api/config/backup/local') {
        if (!requireAuth(req, res)) return;
        const backup = await createLocalConfigBackup(runtimeManager.config, 'admin-ui-local-backup');
        logger.info({ msg: 'Local config backup created', fileName: backup.fileName, configVersion: backup.configVersion });
        sendJson(res, 200, { ok: true, backup });
        return;
      }

      if (method === 'POST' && pathname === '/api/config/backup/thingsboard') {
        if (!requireAuth(req, res)) return;
        const runtime = runtimeManager.currentRuntime;
        if (!runtime) {
          sendJson(res, 503, { error: runtimeManager.error || 'Runtime is not ready' });
          return;
        }
        const envelope = normalizeConfigBackupEnvelope(runtimeManager.config);
        const attrs = thingsBoardConfigBackupAttributes({
          ...envelope,
          source: 'admin-ui-thingsboard-backup',
          createdAt: new Date().toISOString()
        });
        await runtime.tb.publishClientAttributes(attrs);
        const metadata = attrs['edge.configBackupMeta'];
        logger.info({ msg: 'ThingsBoard config backup published', configVersion: metadata.configVersion, hash: metadata.hash });
        sendJson(res, 200, { ok: true, backup: metadata });
        return;
      }

      if (method === 'POST' && pathname === '/api/config/restore/local') {
        if (!requireAuth(req, res)) return;
        const body = await readJsonBody(req);
        const fileName = String(body.fileName || '');
        const envelope = await readLocalConfigBackup(fileName);
        const rollbackBackup = await createLocalConfigBackup(runtimeManager.config, 'admin-ui-pre-restore-rollback');
        try {
          await runtimeManager.saveAndApplyConfig(envelope.config, 'admin-ui-local-restore');
          logger.warn({
            msg: 'Local config backup restored',
            fileName,
            configVersion: envelope.configVersion,
            rollbackFileName: rollbackBackup.fileName
          });
          sendJson(res, 200, {
            ok: true,
            config: runtimeManager.config,
            backup: {
              fileName,
              configVersion: envelope.configVersion,
              hash: envelope.hash,
              createdAt: envelope.createdAt
            },
            rollbackBackup
          });
        } catch (error: any) {
          if (error?.configSaved) {
            sendJson(res, 202, {
              ok: false,
              config: runtimeManager.config,
              runtimeApplyError: error?.message || String(error),
              rollbackBackup
            });
            return;
          }
          throw error;
        }
        return;
      }

      if (method === 'POST' && pathname === '/api/config/restore/upload') {
        if (!requireAuth(req, res)) return;
        const body = await readJsonBody(req);
        const envelope = normalizeConfigBackupEnvelope(body.backup || body.config || body);
        const rollbackBackup = await createLocalConfigBackup(runtimeManager.config, 'admin-ui-pre-upload-restore-rollback');
        try {
          await runtimeManager.saveAndApplyConfig(envelope.config, 'admin-ui-upload-restore');
          logger.warn({ msg: 'Uploaded config backup restored', configVersion: envelope.configVersion, rollbackFileName: rollbackBackup.fileName });
          sendJson(res, 200, { ok: true, config: runtimeManager.config, backup: envelope, rollbackBackup });
        } catch (error: any) {
          if (error?.configSaved) {
            sendJson(res, 202, {
              ok: false,
              config: runtimeManager.config,
              runtimeApplyError: error?.message || String(error),
              rollbackBackup
            });
            return;
          }
          throw error;
        }
        return;
      }

      if (method === 'POST' && pathname === '/api/config/restore/thingsboard') {
        if (!requireAuth(req, res)) return;
        const runtime = runtimeManager.currentRuntime;
        if (!runtime) {
          sendJson(res, 503, { error: runtimeManager.error || 'Runtime is not ready' });
          return;
        }
        const payload = await runtime.tb.requestConfigBackup();
        const envelope = extractThingsBoardConfigBackup(payload);
        if (!envelope) {
          sendJson(res, 404, { error: 'No ThingsBoard config backup attribute found' });
          return;
        }
        const rollbackBackup = await createLocalConfigBackup(runtimeManager.config, 'admin-ui-pre-thingsboard-restore-rollback');
        try {
          await runtimeManager.saveAndApplyConfig(envelope.config, 'admin-ui-thingsboard-restore');
          logger.warn({ msg: 'ThingsBoard config backup restored', configVersion: envelope.configVersion, rollbackFileName: rollbackBackup.fileName });
          sendJson(res, 200, { ok: true, config: runtimeManager.config, backup: envelope, rollbackBackup });
        } catch (error: any) {
          if (error?.configSaved) {
            sendJson(res, 202, {
              ok: false,
              config: runtimeManager.config,
              runtimeApplyError: error?.message || String(error),
              rollbackBackup
            });
            return;
          }
          throw error;
        }
        return;
      }

      if (method === 'PUT' && pathname === '/api/config') {
        if (!requireAuth(req, res)) return;
        const nextCfg = (await readJsonBody(req)) as EdgeConfig;
        const normalized = mergeConfig(runtimeManager.config, nextCfg);
        try {
          await runtimeManager.saveAndApplyConfig(normalized, 'admin-ui-save');
          sendJson(res, 200, runtimeManager.config);
        } catch (error: any) {
          if (error?.configSaved) {
            sendJson(res, 202, {
              ...runtimeManager.config,
              runtimeApplyError: error?.message || String(error)
            });
            return;
          }
          throw error;
        }
        return;
      }

      if (method === 'GET' && pathname === '/api/opcua/browse') {
        if (!requireAuth(req, res)) return;
        const runtime = runtimeManager.currentRuntime;
        if (!runtime) {
          sendJson(res, 503, { error: runtimeManager.error || 'OPC UA runtime is not ready' });
          return;
        }
        const nodeId = url.searchParams.get('nodeId') || 'RootFolder';
        const nodes = await runtime.opc.browse(nodeId);
        sendJson(res, 200, { nodeId, nodes });
        return;
      }

      if (method === 'GET' && pathname === '/api/opcua/discover') {
        if (!requireAuth(req, res)) return;
        const runtime = runtimeManager.currentRuntime;
        if (!runtime) {
          sendJson(res, 503, { error: runtimeManager.error || 'OPC UA runtime is not ready' });
          return;
        }
        const rootNodeId = url.searchParams.get('rootNodeId') || url.searchParams.get('nodeId') || 'RootFolder';
        const maxDepth = Number(url.searchParams.get('maxDepth') || 6);
        const maxNodes = Number(url.searchParams.get('maxNodes') || 1000);
        const timeoutMs = Number(url.searchParams.get('timeoutMs') || 15000);
        const result = await runtime.opc.discoverVariables(rootNodeId, { maxDepth, maxNodes, timeoutMs });
        sendJson(res, 200, result);
        return;
      }

      if (method === 'POST' && pathname === '/api/opcua/mapping') {
        if (!requireAuth(req, res)) return;
        const body = await readJsonBody(req);
        const key = slugifyKey(String(body.key || body.displayName || body.browseName || ''));
        const nodeId = String(body.nodeId || '').trim();
        const type = String(body.type || 'String') as DataTypeName;
        const writable = Boolean(body.writable);
        const target = body.target || {};

        if (!nodeId) {
          sendJson(res, 400, { error: 'nodeId is required' });
          return;
        }

        const cfg = runtimeManager.config;
        const duplicate = cfg.mapping.find((tag) => tag.key === key || tag.nodeId === nodeId);
        if (duplicate) {
          sendJson(res, 409, { error: `Mapping already exists for ${duplicate.key}` });
          return;
        }

        const nextCfg: EdgeConfig = {
          ...cfg,
          mapping: [
            ...cfg.mapping,
            normalizeMapping({
              key,
              nodeId,
              type,
              writable,
              target
            })
          ]
        };

        await runtimeManager.saveAndApplyConfig(nextCfg, 'admin-ui-add-opcua-tag');
        sendJson(res, 200, runtimeManager.config);
        return;
      }

      if (method === 'GET' && pathname === '/') {
        sendHtml(res, renderAdminUi());
        return;
      }

      res.writeHead(404);
      res.end();
    } catch (error: any) {
      logger.error({ msg: 'HTTP handler error', error: error?.message || String(error) });
      sendJson(res, 500, { error: error?.message || 'Internal server error' });
    }
  });

  const reconcileSavedConfig = async () => {
    if (savedConfigReconcileInFlight) return;
    savedConfigReconcileInFlight = true;
    try {
      const storedConfig = await loadConfig();
      const storedVersion = configVersion(storedConfig);
      const managerVersion = configVersion(runtimeManager.config);
      const activeVersion = runtimeManager.currentRuntime
        ? configVersion(runtimeManager.currentRuntime.cfg)
        : null;
      const managerDiffers = storedVersion !== managerVersion;
      const activeDiffers = runtimeManager.state === 'ready' && !!activeVersion && activeVersion !== storedVersion;

      if (managerDiffers || activeDiffers) {
        logger.warn({
          msg: 'Saved config differs from active runtime; applying stored config',
          storedVersion,
          managerVersion,
          activeVersion,
          managerDiffers,
          activeDiffers,
          tbUrl: storedConfig.tb.url,
          opcuaUrl: storedConfig.opcua.url
        });
        await runtimeManager.saveAndApplyConfig(storedConfig, 'saved-config-reconcile');
      }
    } catch (error: any) {
      logger.error({ msg: 'Saved config reconcile failed', error: error?.message || String(error) });
    } finally {
      savedConfigReconcileInFlight = false;
    }
  };

  const reconcileIntervalMs = Math.max(1000, Number(process.env.CONFIG_RECONCILE_INTERVAL_MS || 5000));

  server.listen(port, () => {
    logger.info({ msg: 'Gateway admin UI and health endpoints up', port });
  });

  savedConfigReconcileTimer = setInterval(() => {
    reconcileSavedConfig().catch((error: any) => {
      logger.error({ msg: 'Saved config reconcile loop failed', error: error?.message || String(error) });
    });
  }, reconcileIntervalMs);
  savedConfigReconcileTimer.unref?.();

  runtimeManager.start('startup')
    .then(() => runtimeManager.applyStartupDesiredConfig())
    .catch(async (error: any) => {
      await runtimeManager.publishFailedConfigStatus(error?.message || String(error));
    });

  let shutdownStarted = false;
  const shutdown = async () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    logger.info({ msg: 'Shutting down' });
    if (savedConfigReconcileTimer) clearInterval(savedConfigReconcileTimer);
    server.close();
    await runtimeManager.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
