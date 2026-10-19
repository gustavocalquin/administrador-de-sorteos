import initSqlJs, { type Database as MemoryDatabase } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Database, type SqlDriver, type SqlRow, type SqlValue } from '../infrastructure/database/driver';
import { migrate } from '../infrastructure/database/migrate';

/** Disposable development database. Never used as Android storage. */
class BrowserDriver implements SqlDriver {
  constructor(private readonly sqlite: MemoryDatabase) {}
  async execute(sql: string) { this.sqlite.exec(sql); }
  async run(sql: string, values: SqlValue[] = []) { this.sqlite.run(sql, values); }
  async query<T extends SqlRow>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    const statement = this.sqlite.prepare(sql);
    try {
      statement.bind(values);
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      return rows;
    } finally { statement.free(); }
  }
  async begin() { this.sqlite.run('BEGIN IMMEDIATE;'); }
  async commit() { this.sqlite.run('COMMIT;'); }
  async rollback() { this.sqlite.run('ROLLBACK;'); }
  async close() { this.sqlite.close(); }
}
export async function openBrowserDatabase(): Promise<Database> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const driver = new BrowserDriver(new SQL.Database());
  await migrate(driver);
  return new Database(driver);
}
