// ABOUTME: better-sqlite3 单例连接与数据库初始化入口
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { config } from './config';
import { runMigrations } from './migrations';

let dbInstance: DB | null = null;

export function getDb(): DB {
  if (dbInstance) return dbInstance;

  const dbPath = config.dbPath;
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  dbInstance = db;
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
