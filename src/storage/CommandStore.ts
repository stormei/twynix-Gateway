import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';

export type CommandStatus = 'pending' | 'done' | 'error';

export interface CommandRecord {
  id: number;
  reqId: string;
  receivedTs: number;
  method: string;
  paramsJson: string;
  status: CommandStatus;
  responseJson?: string | null;
  errorMsg?: string | null;
  completedTs?: number | null;
}

function ensureDirForFile(filePath: string) {
  const dir = path.dirname(filePath);
  fs.ensureDirSync(dir);
}

/**
 * SQLite-backed journal for TB RPC requests.
 * Goals:
 *  - Idempotency: same reqId => return same response
 *  - Traceability: keep last N commands for audit/debug
 *  - Crash resilience: don't lose request metadata
 */
export class CommandStore {
  private db: Database.Database;
  private maxRows: number;

  private stmtGet: Database.Statement;
  private stmtInsert: Database.Statement;
  private stmtMarkDone: Database.Statement;
  private stmtMarkError: Database.Statement;
  private stmtPrune: Database.Statement;

  constructor(sqlitePath: string, maxRows: number) {
    ensureDirForFile(sqlitePath);
    this.db = new Database(sqlitePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.maxRows = Math.max(1000, Math.floor(maxRows || 200000));

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rpc_journal (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        req_id        TEXT NOT NULL UNIQUE,
        received_ts   INTEGER NOT NULL,
        method        TEXT NOT NULL,
        params_json   TEXT NOT NULL,
        status        TEXT NOT NULL,
        response_json TEXT,
        error_msg     TEXT,
        completed_ts  INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_rpc_journal_received
      ON rpc_journal(received_ts);
    `);

    this.stmtGet = this.db.prepare(
      `SELECT id,
              req_id as reqId,
              received_ts as receivedTs,
              method,
              params_json as paramsJson,
              status,
              response_json as responseJson,
              error_msg as errorMsg,
              completed_ts as completedTs
       FROM rpc_journal
       WHERE req_id = ?`
    );
    this.stmtInsert = this.db.prepare(
      `INSERT INTO rpc_journal(req_id, received_ts, method, params_json, status)
       VALUES (?, ?, ?, ?, 'pending')`
    );
    this.stmtMarkDone = this.db.prepare(
      `UPDATE rpc_journal
       SET status='done', response_json=?, error_msg=NULL, completed_ts=?
       WHERE req_id = ?`
    );
    this.stmtMarkError = this.db.prepare(
      `UPDATE rpc_journal
       SET status='error', response_json=?, error_msg=?, completed_ts=?
       WHERE req_id = ?`
    );
    this.stmtPrune = this.db.prepare(
      `DELETE FROM rpc_journal
       WHERE id IN (
         SELECT id FROM rpc_journal
         ORDER BY id DESC
         LIMIT -1 OFFSET ?
       )`
    );
  }

  // Naming used by TbBridge
  getByReqId(reqId: string): CommandRecord | undefined {
    return this.stmtGet.get(reqId) as CommandRecord | undefined;
  }

  // Alias
  get(reqId: string): CommandRecord | undefined {
    return this.getByReqId(reqId);
  }

  /**
   * Returns existing record if already inserted.
   */
  // Naming used by TbBridge
  addPending(reqId: string, method: string, paramsJson: string, receivedTs: number): CommandRecord {
    const existing = this.getByReqId(reqId);
    if (existing) return existing;

    try {
      this.stmtInsert.run(reqId, receivedTs, method, paramsJson);
      this.pruneIfNeeded();
    } catch {
      // race: another handler inserted first
    }
    return this.getByReqId(reqId) as CommandRecord;
  }

  // Alias
  upsertPending(reqId: string, method: string, paramsJson: string, receivedTs: number): CommandRecord {
    return this.addPending(reqId, method, paramsJson, receivedTs);
  }

  markDone(reqId: string, responseJson: string) {
    this.stmtMarkDone.run(responseJson, Date.now(), reqId);
  }

  markError(reqId: string, responseJson: string, errorMsg: string) {
    this.stmtMarkError.run(responseJson, errorMsg, Date.now(), reqId);
  }

  private pruneIfNeeded() {
    // cheap prune: keep last maxRows by id
    this.stmtPrune.run(this.maxRows);
  }

  close() {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }
}
