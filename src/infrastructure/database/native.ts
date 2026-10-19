import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { Database, type SqlDriver, type SqlRow, type SqlValue } from './driver';
import { migrate } from './migrate';

const connections = new SQLiteConnection(CapacitorSQLite);
const openings = new Map<string, Promise<Database>>();

class NativeDriver implements SqlDriver {
  constructor(private readonly connection: SQLiteDBConnection, private readonly name: string) {}
  async execute(sql: string) { await this.connection.execute(sql, false, true); }
  async run(sql: string, values: SqlValue[] = []) { await this.connection.run(sql, values, false, 'no', true); }
  async query<T extends SqlRow>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return (await this.connection.query(sql, values, true)).values as T[] ?? [];
  }
  async begin() { await this.connection.beginTransaction(); }
  async commit() { await this.connection.commitTransaction(); }
  async rollback() { await this.connection.rollbackTransaction(); }
  async close() {
    await connections.closeConnection(this.name, false);
    openings.delete(this.name);
  }
}

/** No fallback: failing native storage must never silently switch to ephemeral data. */
export function openNativeDatabase(name = 'sorteos'): Promise<Database> {
  if (Capacitor.getPlatform() !== 'android') return Promise.reject(new Error('SQLite nativo requiere Android.'));
  const existing = openings.get(name);
  if (existing) return existing;
  const opening = (async () => {
    const connection = (await connections.isConnection(name, false)).result
      ? await connections.retrieveConnection(name, false)
      : await connections.createConnection(name, false, 'no-encryption', 1, false);
    const driver = new NativeDriver(connection, name);
    try {
      await connection.open();
      await migrate(driver);
      return new Database(driver);
    } catch (error) {
      // Close handles only. Never delete files or reset schema to recover.
      try { await connections.closeConnection(name, false); } catch { /* Original error remains actionable. */ }
      throw error;
    }
  })();
  openings.set(name, opening);
  void opening.catch(() => { openings.delete(name); });
  return opening;
}
