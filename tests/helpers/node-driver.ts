import { DatabaseSync } from 'node:sqlite';
import type { SqlDriver, SqlRow, SqlValue } from '../../src/infrastructure/database/driver';

/** Real SQLite on the desktop. Does not claim to exercise the Capacitor bridge. */
export class NodeDriver implements SqlDriver {
  private readonly sqlite: DatabaseSync;
  constructor(path = ':memory:') { this.sqlite = new DatabaseSync(path); }
  async execute(sql: string) { this.sqlite.exec(sql); }
  async run(sql: string, values: SqlValue[] = []) { this.sqlite.prepare(sql).run(...values); }
  async query<T extends SqlRow>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.sqlite.prepare(sql).all(...values) as T[];
  }
  async begin() { this.sqlite.exec('BEGIN IMMEDIATE;'); }
  async commit() { this.sqlite.exec('COMMIT;'); }
  async rollback() { this.sqlite.exec('ROLLBACK;'); }
  async close() { this.sqlite.close(); }
}
