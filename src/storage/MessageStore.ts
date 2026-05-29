import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';
import { logger } from '../logger.js';

export interface BufferedMessage {
  id?: number;
  topic: string;
  payload: string;
  ts?: number;
}

export class MessageStore {
  private db: Database.Database;
  private insertStmt;
  private selectStmt;
  private deleteStmt;
  private countStmt;
  private statsStmt;
  private purgeStmt;
  private maxRows: number;

  constructor(dbPath: string, maxRows: number) {
    fs.ensureDirSync(path.dirname(dbPath));
    this.maxRows = maxRows;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      payload TEXT NOT NULL,
      ts INTEGER NOT NULL
    )`);
    this.insertStmt = this.db.prepare('INSERT INTO messages (topic, payload, ts) VALUES (?, ?, ?)');
    this.selectStmt = this.db.prepare('SELECT id, topic, payload, ts FROM messages ORDER BY id ASC LIMIT ?');
    this.deleteStmt = this.db.prepare('DELETE FROM messages WHERE id = ?');
    this.countStmt = this.db.prepare('SELECT COUNT(*) as c FROM messages');
    this.statsStmt = this.db.prepare('SELECT COUNT(*) as c, MIN(ts) as oldestTs, MAX(ts) as newestTs, SUM(LENGTH(payload)) as payloadBytes FROM messages');
    this.purgeStmt = this.db.prepare('DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY id ASC LIMIT ?)');
    logger.info({ msg: 'SQLite store ready', dbPath, maxRows });
  }

  count(): number {
    const row = this.countStmt.get() as any;
    return row.c as number;
  }

  stats() {
    const row = this.statsStmt.get() as any;
    const now = Date.now();
    const count = Number(row.c || 0);
    const oldestTs = row.oldestTs == null ? null : Number(row.oldestTs);
    const newestTs = row.newestTs == null ? null : Number(row.newestTs);
    return {
      count,
      oldestTs,
      newestTs,
      oldestAgeMs: oldestTs == null ? null : Math.max(0, now - oldestTs),
      newestAgeMs: newestTs == null ? null : Math.max(0, now - newestTs),
      payloadBytes: Number(row.payloadBytes || 0),
      maxRows: this.maxRows
    };
  }

  add(msg: BufferedMessage) {
    const c = this.count();
    let purged = 0;
    if (c >= this.maxRows) {
      const toDelete = Math.ceil(this.maxRows * 0.1); // purge oldest 10%
      const info = this.purgeStmt.run(toDelete);
      purged = Number(info.changes || 0);
      logger.warn({ msg: 'Purged buffered messages to respect maxRows', deleted: info.changes });
    }
    this.insertStmt.run(msg.topic, msg.payload, msg.ts ?? Date.now());
    return { purged };
  }

  getBatch(limit: number): BufferedMessage[] {
    return this.selectStmt.all(limit) as BufferedMessage[];
  }

  remove(id: number) {
    this.deleteStmt.run(id);
  }

  close() {
    this.db.close();
  }
}
