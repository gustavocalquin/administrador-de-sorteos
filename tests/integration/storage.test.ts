import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeDriver } from '../helpers/node-driver';
import { Database } from '../../src/infrastructure/database/driver';
import { migrate, migrations } from '../../src/infrastructure/database/migrate';
import { insertRaffle, SqliteRaffleRepository } from '../../src/infrastructure/database/repositories/raffles';
import { checkRollback, diagnosticRaffle, writeDiagnostic } from '../../src/dev/diagnostic-service';

describe('SQLite real: esquema, integridad y persistencia', () => {
  let driver: NodeDriver;
  let db: Database;
  beforeEach(async () => { driver = new NodeDriver(); await migrate(driver); db = new Database(driver); });
  afterEach(async () => { await db.close(); });

  it('crea una base vacía y repite apertura sin perder datos', async () => {
    expect(await new SqliteRaffleRepository(db).list()).toEqual([]);
    await writeDiagnostic(db);
    await migrate(driver);
    expect(await driver.query('PRAGMA user_version;')).toEqual([{ user_version: migrations.length }]);
    expect(await driver.query('PRAGMA foreign_keys;')).toEqual([{ foreign_keys: 1 }]);
    expect(await new SqliteRaffleRepository(db).list()).toHaveLength(1);
  });

  it('persiste UUID, campos y números al cerrar y reabrir el archivo', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'sorteos-test-'));
    const path = join(folder, 'data.sqlite');
    let fileDb: Database | undefined;
    try {
      const firstDriver = new NodeDriver(path); await migrate(firstDriver); fileDb = new Database(firstDriver);
      const before = await writeDiagnostic(fileDb);
      await fileDb.close(); fileDb = undefined;
      const secondDriver = new NodeDriver(path); await migrate(secondDriver); fileDb = new Database(secondDriver);
      expect(await new SqliteRaffleRepository(fileDb).list()).toEqual(before.records);
      expect(await secondDriver.query('SELECT count(*) AS n FROM raffle_numbers;')).toEqual([{ n: 3 }]);
    } finally { await fileDb?.close(); await rm(folder, { recursive: true }); }
  });

  it('revierte todos los números, sorteo e historial ante duplicación', async () => {
    expect(await checkRollback(db)).toContain('revertidos');
    expect(await new SqliteRaffleRepository(db).list()).toEqual([]);
  });

  it('serializa escrituras concurrentes y no duplica la muestra', async () => {
    await Promise.all([writeDiagnostic(db), writeDiagnostic(db), writeDiagnostic(db)]);
    expect(await driver.query('SELECT count(*) AS n FROM raffles;')).toEqual([{ n: 1 }]);
    expect(await driver.query('SELECT count(*) AS n FROM movements;')).toEqual([{ n: 1 }]);
  });

  it('una migración fallida preserva datos y versión y elimina su DDL', async () => {
    const before = await writeDiagnostic(db);
    await expect(migrate(driver, [...migrations, { version: migrations.length + 1, sql: 'CREATE TABLE transient_data(id TEXT); INSERT INTO no_table VALUES (1);' }])).rejects.toThrow();
    expect(await driver.query('PRAGMA user_version;')).toEqual([{ user_version: migrations.length }]);
    expect(await driver.query("SELECT name FROM sqlite_master WHERE name = 'transient_data';")).toEqual([]);
    expect(await new SqliteRaffleRepository(db).list()).toEqual(before.records);
  });

  it('rechaza versiones futuras sin modificar registros o versión', async () => {
    const before = await writeDiagnostic(db);
    await driver.execute('PRAGMA user_version = 99;');
    await expect(migrate(driver)).rejects.toThrow('más nueva');
    expect(await driver.query('PRAGMA user_version;')).toEqual([{ user_version: 99 }]);
    expect(await new SqliteRaffleRepository(db).list()).toEqual(before.records);
  });

  it('permite teléfonos compartidos y obliga a separar nombre y apellido', async () => {
    const insert = 'INSERT INTO buyers (id, phone, phone_key, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?);';
    for (const name of ['Ana', 'Luis']) await driver.run(insert, [crypto.randomUUID(), '+54 11 1234', '54111234', name, 'Pérez', 'now', 'now']);
    expect(await driver.query('SELECT count(*) AS n FROM buyers;')).toEqual([{ n: 2 }]);
    await expect(driver.run(insert, [crypto.randomUUID(), '+54 11 1234', '54111234', 'Ana', ' ', 'now', 'now'])).rejects.toThrow();
  });

  it('rechaza referencias inexistentes y números fuera de rango', async () => {
    const raffle = diagnosticRaffle(); await db.transaction(tx => insertRaffle(tx, raffle));
    const insert = 'INSERT INTO raffle_numbers (id, raffle_id, value, status) VALUES (?, ?, ?, ?);';
    await expect(driver.run(insert, [crypto.randomUUID(), raffle.id, 3, 'disponible'])).rejects.toThrow();
    await expect(driver.run(insert, [crypto.randomUUID(), 'no-existe', 0, 'disponible'])).rejects.toThrow();
    await expect(driver.run('INSERT INTO prizes (id, raffle_id, position, description) VALUES (?, ?, 1, ?);', ['p1', 'no-existe', 'Premio'])).rejects.toThrow();
  });

  it('impide asignaciones de otro sorteo y de otro comprador', async () => {
    const a = diagnosticRaffle(); const b = diagnosticRaffle();
    await db.transaction(async tx => { await insertRaffle(tx, a); await insertRaffle(tx, b); });
    for (const id of ['buyer1', 'buyer2']) await driver.run('INSERT INTO buyers (id, phone, phone_key, first_name, last_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?);', [id, '123', '123', 'Nombre', 'Apellido', 'now', 'now']);
    await driver.run("INSERT INTO operations (id, raffle_id, buyer_id, type, status, amount_cents, created_at, updated_at) VALUES ('op', ?, 'buyer1', 'reserva', 'vigente', 0, 'now', 'now');", [a.id]);
    const insert = "INSERT INTO raffle_numbers (id, raffle_id, value, status, buyer_id, active_operation_id) VALUES (?, ?, 0, 'reservado', ?, 'op');";
    await expect(driver.run(insert, ['n1', b.id, 'buyer1'])).rejects.toThrow();
    await expect(driver.run(insert, ['n2', a.id, 'buyer2'])).rejects.toThrow();
    await driver.run(insert, ['n3', a.id, 'buyer1']);
  });

  it('impide modificar o borrar el historial', async () => {
    await writeDiagnostic(db);
    await expect(driver.run("UPDATE movements SET action = 'ocultar';")).rejects.toThrow('inmutable');
    await expect(driver.run('DELETE FROM movements;')).rejects.toThrow('inmutable');
  });

  it('conserva texto literal mediante parámetros y dinero entero', async () => {
    const raffle = { ...diagnosticRaffle(), name: "Rifa O'Brien'); DROP TABLE raffles; --" };
    await db.transaction(tx => insertRaffle(tx, raffle));
    expect(await new SqliteRaffleRepository(db).findById(raffle.id)).toEqual(raffle);
    await expect(driver.run('UPDATE raffles SET unit_price_cents = 1.5 WHERE id = ?;', [raffle.id])).rejects.toThrow();
  });
});

