// ABOUTME: 极简顺序迁移框架：按 id 升序执行未应用的迁移，全部包裹在事务中
import type { Database } from 'better-sqlite3';

export interface Migration {
  /** 单调递增的迁移编号，从 1 开始 */
  id: number;
  /** 迁移名称（仅用于日志/审计） */
  name: string;
  up: (db: Database) => void;
}

/**
 * 迁移注册表。业务表（O/F/J 三单等）待发单方下发执行指令后，
 * 按 { id: 2, name: '...', up: db => db.exec(`...`) } 顺序追加，
 * 严禁修改已发布的迁移。
 */
const migrations: Migration[] = [
  {
    id: 1,
    name: 'init_migrations_table',
    up: db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id          INTEGER PRIMARY KEY,
          name        TEXT NOT NULL,
          applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
];

function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function runMigrations(db: Database): void {
  ensureMigrationsTable(db);

  const appliedRows = db.prepare('SELECT id FROM _migrations').all() as Array<{ id: number }>;
  const applied = new Set(appliedRows.map(r => r.id));

  const pending = [...migrations]
    .sort((a, b) => a.id - b.id)
    .filter(m => !applied.has(m.id));

  if (pending.length === 0) {
    console.log(`[db] migrations up to date (${appliedRows.length} applied)`);
    return;
  }

  const insertApplied = db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)');

  const applyAll = db.transaction(() => {
    for (const m of pending) {
      console.log(`[db] applying migration ${m.id}: ${m.name}`);
      m.up(db);
      insertApplied.run(m.id, m.name);
    }
  });
  applyAll();

  console.log(`[db] applied ${pending.length} migration(s)`);
}
