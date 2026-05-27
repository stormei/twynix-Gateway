import winston from 'winston';
import path from 'path';
import fs from 'fs';

export type RecentLogEntry = {
  ts: string;
  level: string;
  message: unknown;
  meta: Record<string, unknown>;
  stack?: string;
};

const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
const RECENT_LOG_LIMIT = Number(process.env.RECENT_LOG_LIMIT || 1000);
export const LOG_DIR = path.resolve(process.env.LOG_DIR || './logs');
export const LOG_FILE = path.join(LOG_DIR, 'gateway.log');

const recentLogs: RecentLogEntry[] = [];
const secretKeyPattern = /token|password|secret|authorization|access|private.?key/i;

fs.mkdirSync(LOG_DIR, { recursive: true });

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = secretKeyPattern.test(key) ? '[redacted]' : sanitizeLogValue(item, depth + 1);
    }
    return out;
  }
  return value;
}

function captureRecentLog(info: winston.Logform.TransformableInfo) {
  const { level, message, timestamp, stack, ...meta } = info as Record<string, unknown>;
  recentLogs.push({
    ts: String(timestamp || new Date().toISOString()),
    level: String(level || 'info'),
    message: sanitizeLogValue(message),
    meta: sanitizeLogValue(meta) as Record<string, unknown>,
    stack: stack ? String(stack) : undefined
  });
  if (recentLogs.length > RECENT_LOG_LIMIT) {
    recentLogs.splice(0, recentLogs.length - RECENT_LOG_LIMIT);
  }
}

const recentLogCapture = winston.format((info) => {
  captureRecentLog(info);
  return info;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    recentLogCapture(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({}),
    new winston.transports.File({
      filename: LOG_FILE,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    })
  ]
});

export function getRecentLogs(options: { limit?: number; level?: string; q?: string } = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 200), RECENT_LOG_LIMIT));
  const level = options.level && options.level !== 'all' ? options.level : '';
  const query = (options.q || '').trim().toLowerCase();

  let logs = recentLogs;
  if (level) {
    logs = logs.filter((entry) => entry.level === level);
  }
  if (query) {
    logs = logs.filter((entry) => JSON.stringify(entry).toLowerCase().includes(query));
  }
  return logs.slice(-limit).reverse();
}

export function getLogCapabilities() {
  return {
    currentLevel: logger.level,
    levels: LOG_LEVELS,
    logDir: LOG_DIR,
    logFile: LOG_FILE,
    recentLogLimit: RECENT_LOG_LIMIT,
    recentLogCount: recentLogs.length,
    fileTransport: true,
    memoryTransport: true
  };
}

export function setRuntimeLogLevel(level: string) {
  if (!LOG_LEVELS.includes(level as any)) {
    throw new Error(`Unsupported log level: ${level}`);
  }
  logger.level = level;
  for (const transport of logger.transports) {
    transport.level = level;
  }
  return getLogCapabilities();
}
