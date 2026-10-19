export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;

/** A session deliberately has no transaction() method: callers cannot nest transactions. */
export interface SqlSession {
  execute(sql: string): Promise<void>;
  run(sql: string, values?: SqlValue[]): Promise<void>;
  query<T extends SqlRow = SqlRow>(sql: string, values?: SqlValue[]): Promise<T[]>;
}
export interface SqlDriver extends SqlSession {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}

/** Serializes reads and writes, so another operation cannot enter an active transaction. */
export class Database {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly driver: SqlDriver) {}

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }

  read<T>(work: (session: SqlSession) => Promise<T>): Promise<T> {
    return this.enqueue(() => work(this.driver));
  }

  transaction<T>(work: (session: SqlSession) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.driver.begin();
      try {
        const result = await work(this.driver);
        await this.driver.commit();
        return result;
      } catch (error) {
        try { await this.driver.rollback(); }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Fallaron la operación y su reversión.', { cause: rollbackError }); }
        throw error;
      }
    });
  }

  close(): Promise<void> { return this.enqueue(() => this.driver.close()); }
}
