import fs from 'node:fs';
import path from 'node:path';
// SQLite ships inside Node itself, so there is nothing extra to install or compile.
import { DatabaseSync } from 'node:sqlite';
import { DIFFICULTIES, isDifficulty, type BankEntry, type Difficulty, type LeaderboardEntry } from '@casino/shared';
import type { Store, UserRecord } from './Store';

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  color: string;
  cash: number;
  apt_level: number;
  best_round: number;
  best_level: string;
  outfit: string;
}

const parseList = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const toUser = (r: UserRow | undefined): UserRecord | null =>
  r
    ? {
        id: r.id,
        username: r.username,
        passwordHash: r.password_hash,
        color: r.color,
        cash: r.cash,
        aptLevel: r.apt_level,
        bestRound: r.best_round,
        bestLevel: isDifficulty(r.best_level) ? r.best_level : 'hard',
        outfit: parseList(r.outfit ?? '[]'),
      }
    : null;

/** A user row's leaderboard handicap, in SQL: the same numbers as DIFFICULTIES. */
const SCORE_BONUS = `(CASE best_level ${Object.entries(DIFFICULTIES).map(([k, d]) => `WHEN '${k}' THEN ${d.handicap}`).join(' ')} ELSE 0 END)`;

export class SqliteStore implements Store {
  private db: DatabaseSync;

  /** Pass ':memory:' for a throwaway database (tests). */
  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        color TEXT NOT NULL,
        chips INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bank (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount INTEGER NOT NULL,
        balance INTEGER NOT NULL,
        note TEXT NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS bank_user ON bank (user_id, id);
      CREATE TABLE IF NOT EXISTS owned (
        user_id INTEGER NOT NULL REFERENCES users(id),
        item_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (user_id, item_id)
      );
    `);
    // Columns added after the first version: bring an older database file up to date.
    const have = new Set(this.db.prepare('PRAGMA table_info(users)').all().map((c) => String(c.name)));
    const added: [string, string][] = [
      ['round', 'INTEGER NOT NULL DEFAULT 1'],
      ['hands', 'INTEGER NOT NULL DEFAULT 0'],
      ['best_round', 'INTEGER NOT NULL DEFAULT 1'],
      ['cash', 'INTEGER NOT NULL DEFAULT 0'],
      ['apt_level', 'INTEGER NOT NULL DEFAULT 1'],
      ['outfit', "TEXT NOT NULL DEFAULT '[]'"],
      // Runs before difficulty levels were all played at what is now Hard.
      ['best_level', "TEXT NOT NULL DEFAULT 'hard'"],
    ];
    for (const [name, type] of added) {
      if (!have.has(name)) this.db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
    }
  }

  async createUser(username: string, passwordHash: string, color: string) {
    try {
      const info = this.db
        .prepare('INSERT INTO users (username, username_lower, password_hash, color, chips, created_at) VALUES (?, ?, ?, ?, 0, ?)')
        .run(username, username.toLowerCase(), passwordHash, color, Date.now());
      return this.getUserById(Number(info.lastInsertRowid));
    } catch (err) {
      if (err instanceof Error && /UNIQUE/i.test(err.message)) return null;
      throw err;
    }
  }

  async getUserByName(username: string) {
    return toUser(this.db.prepare('SELECT * FROM users WHERE username_lower = ?').get(username.toLowerCase()) as unknown as UserRow | undefined);
  }

  async getUserById(id: number) {
    return toUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined);
  }

  async setColor(id: number, color: string) {
    this.db.prepare('UPDATE users SET color = ? WHERE id = ?').run(color, id);
  }

  async addCash(id: number, delta: number, note: string) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE users SET cash = MAX(0, cash + ?) WHERE id = ?').run(delta, id);
      const row = this.db.prepare('SELECT cash FROM users WHERE id = ?').get(id) as { cash: number } | undefined;
      this.db.prepare('INSERT INTO bank (user_id, amount, balance, note, at) VALUES (?, ?, ?, ?, ?)').run(id, delta, row?.cash ?? 0, note.slice(0, 120), Date.now());
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async ownedItems(id: number): Promise<string[]> {
    return this.db
      .prepare('SELECT item_id FROM owned WHERE user_id = ? ORDER BY at')
      .all(id)
      .map((r) => String(r.item_id));
  }

  async addOwned(id: number, itemId: string) {
    this.db.prepare('INSERT OR IGNORE INTO owned (user_id, item_id, at) VALUES (?, ?, ?)').run(id, itemId, Date.now());
  }

  async removeOwned(id: number, itemId: string) {
    this.db.prepare('DELETE FROM owned WHERE user_id = ? AND item_id = ?').run(id, itemId);
  }

  async buy(id: number, itemId: string, price: number, note: string, aptLevel?: number): Promise<boolean> {
    this.db.exec('BEGIN');
    try {
      // Only if they can afford it: the WHERE clause does the check and the payment in one go.
      const paid = this.db.prepare('UPDATE users SET cash = cash - ? WHERE id = ? AND cash >= ?').run(price, id, price);
      if (Number(paid.changes) !== 1) {
        this.db.exec('ROLLBACK');
        return false;
      }
      this.db.prepare('INSERT OR IGNORE INTO owned (user_id, item_id, at) VALUES (?, ?, ?)').run(id, itemId, Date.now());
      if (aptLevel !== undefined) this.db.prepare('UPDATE users SET apt_level = MAX(apt_level, ?) WHERE id = ?').run(aptLevel, id);
      const row = this.db.prepare('SELECT cash FROM users WHERE id = ?').get(id) as { cash: number };
      this.db.prepare('INSERT INTO bank (user_id, amount, balance, note, at) VALUES (?, ?, ?, ?, ?)').run(id, -price, row.cash, note.slice(0, 120), Date.now());
      this.db.exec('COMMIT');
      return true;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async setOutfit(id: number, items: string[]) {
    this.db.prepare('UPDATE users SET outfit = ? WHERE id = ?').run(JSON.stringify(items), id);
  }

  async bankHistory(id: number, limit: number): Promise<BankEntry[]> {
    const rows = this.db.prepare('SELECT amount, balance, note, at FROM bank WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(id, limit);
    return rows.map((r) => ({ amount: Number(r.amount), balance: Number(r.balance), note: String(r.note), at: Number(r.at) }));
  }

  async setBest(id: number, bestRound: number, level: Difficulty = 'hard') {
    // Only if this run scores higher than the best one so far (round plus the level's handicap).
    this.db
      .prepare(`UPDATE users SET best_round = ?, best_level = ? WHERE id = ? AND ? > best_round + ${SCORE_BONUS}`)
      .run(bestRound, level, id, bestRound + DIFFICULTIES[level].handicap);
  }

  async setAptLevel(id: number, level: number) {
    this.db.prepare('UPDATE users SET apt_level = ? WHERE id = ?').run(level, id);
  }

  async createSession(tokenHash: string, userId: number) {
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(tokenHash, userId, Date.now());
  }

  async getSessionUser(tokenHash: string) {
    return toUser(
      this.db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(tokenHash) as unknown as UserRow | undefined,
    );
  }

  async deleteSession(tokenHash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  async leaderboard(limit: number): Promise<LeaderboardEntry[]> {
    const rows = this.db.prepare(`SELECT username AS name, best_round AS best, best_level AS level, cash FROM users ORDER BY best_round + ${SCORE_BONUS} DESC, cash DESC, id ASC LIMIT ?`).all(limit);
    return rows.map((r) => ({ name: String(r.name), best: Number(r.best), level: isDifficulty(r.level) ? r.level : 'hard', cash: Number(r.cash) }));
  }

  close() {
    this.db.close();
  }
}
