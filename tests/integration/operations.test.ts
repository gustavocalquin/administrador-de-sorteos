import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CatalogService } from '../../src/application/catalog-service';
import { newRaffle } from '../../src/domain/catalog';
import type { BuyerChoice } from '../../src/domain/operations';
import { Database } from '../../src/infrastructure/database/driver';
import { migrate, migrations } from '../../src/infrastructure/database/migrate';
import { NodeDriver } from '../helpers/node-driver';
import { insertRaffle } from '../../src/infrastructure/database/repositories/raffles';

const buyer: BuyerChoice = { kind: 'new', input: { phone: '11 0000 0000', firstName: 'Ana', lastName: 'Prueba', email: null, notes: '' } };
function fixture(quantity = 100) {
  const value = newRaffle(); Object.assign(value.raffle, { name: 'Rifa de prueba', publicContact: 'Club', drawMethod: 'Presencial', quantity, unitPriceCents: 150050 });
  value.prizes[0]!.description = 'Bicicleta'; return value;
}
async function active(catalog: CatalogService, quantity = 100) {
  const saved = await catalog.saveRaffle(fixture(quantity));
  return catalog.setSalesState(saved.raffle.id, saved.revision, 'activo');
}
describe('Etapa 3: operaciones reales, atómicas e históricas', () => {
  let driver: NodeDriver; let db: Database; let catalog: CatalogService; let id: string;
  beforeEach(async () => { driver = new NodeDriver(); await migrate(driver); db = new Database(driver); catalog = new CatalogService(db, 'android'); id = (await active(catalog)).raffle.id; });
  afterEach(async () => { await db.close(); });
  async function assign(values: number[], type: 'reserva' | 'venta' = 'reserva', person = buyer) {
    const b = await catalog.operations.board(id);
    const selection = await Promise.all(values.map(v => catalog.operations.number(id, v)));
    await catalog.operations.assign(id, b.revision, selection, person, type);
  }
  const numbers = (values: number[]) => Promise.all(values.map(value => catalog.operations.number(id, value)));

  it('reserva múltiples números de forma conjunta y crea un único comprador', async () => {
    await assign([0, 2, 17]);
    const b = await catalog.operations.board(id); expect([b.reserved, b.sold, b.available, b.collectedCents]).toEqual([3, 0, 97, 0]);
    const assigned = await numbers([0, 2, 17]); expect(new Set(assigned.map(n => n.operationId)).size).toBe(1);
    expect(await catalog.listBuyers()).toHaveLength(1); expect(assigned.every(n => n.status === 'reservado')).toBe(true);
    expect((await catalog.operations.history(id, 17))[0]!.action).toBe('reserva');
  });
  it('cobra una parte por números enteros y conserva la reserva pendiente', async () => {
    await assign([1, 2, 3]); const before = await numbers([1, 2, 3]);
    await catalog.operations.pay(id, [before[0]!, before[2]!]);
    expect((await numbers([1, 2, 3])).map(n => n.status)).toEqual(['vendido', 'reservado', 'vendido']);
    expect((await catalog.operations.board(id)).collectedCents).toBe(300100);
    expect(await driver.query('SELECT status,amount_cents FROM operations WHERE id=?;', [before[0]!.operationId])).toEqual([{ status: 'parcial', amount_cents: 300100 }]);
    await catalog.operations.pay(id, await numbers([2]));
    expect(await driver.query('SELECT status,amount_cents FROM operations WHERE id=?;', [before[0]!.operationId])).toEqual([{ status: 'completada', amount_cents: 450150 }]);
    await expect(catalog.operations.pay(id, [before[1]!])).rejects.toThrow('cambió');
    expect((await catalog.operations.board(id)).collectedCents).toBe(450150);
  });
  it('vende directamente y reutiliza la misma ficha en otro sorteo con teléfono compartido', async () => {
    const buyerId = await catalog.saveBuyer(buyer.kind === 'new' ? buyer.input : neverBuyer());
    await catalog.saveBuyer({ phone: '1100000000', firstName: 'Luis', lastName: 'Prueba', email: null, notes: '' });
    await assign([0, 9], 'venta', { kind: 'existing', id: buyerId });
    const firstId = id; id = (await active(catalog)).raffle.id;
    await assign([7], 'reserva', { kind: 'existing', id: buyerId });
    expect((await catalog.operations.number(firstId, 0)).buyerId).toBe(buyerId);
    expect((await catalog.operations.number(id, 7)).buyerId).toBe(buyerId);
    expect(await catalog.listBuyers()).toHaveLength(2);
  });
  it('rechaza duplicados, fracciones, fuera de rango y comprador inexistente sin residuos', async () => {
    const b = await catalog.operations.board(id);
    for (const selected of [[], [{ value: 1, revision: 0 }, { value: 1, revision: 0 }], [{ value: 100, revision: 0 }], [{ value: 1.5, revision: 0 }]])
      await expect(catalog.operations.assign(id, b.revision, selected, buyer, 'venta')).rejects.toThrow();
    await expect(catalog.operations.assign(id, b.revision, [{ value: 1, revision: 0 }], { kind: 'existing', id: 'missing' }, 'venta')).rejects.toThrow('comprador');
    expect(await driver.query('SELECT COUNT(*) AS n FROM operations;')).toEqual([{ n: 0 }]);
    expect(await catalog.listBuyers()).toHaveLength(0);
  });
  it('resuelve competencia por un número sin doble venta ni comprador huérfano', async () => {
    const b = await catalog.operations.board(id); const token = { value: 1, revision: 0 };
    const results = await Promise.allSettled([catalog.operations.assign(id, b.revision, [token], buyer, 'venta'), catalog.operations.assign(id, b.revision, [token], buyer, 'reserva')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await catalog.listBuyers()).toHaveLength(1); expect((await catalog.operations.board(id)).sold).toBe(1);
  });
  it('revierte comprador, operación, números e historial cuando falla un detalle intermedio', async () => {
    const before = await driver.query('SELECT * FROM movements;');
    await driver.execute("CREATE TRIGGER reject_second BEFORE INSERT ON operation_items WHEN (SELECT COUNT(*) FROM operation_items)=1 BEGIN SELECT RAISE(ABORT,'fallo intermedio'); END;");
    await expect(assign([1, 2, 3], 'venta')).rejects.toThrow('fallo intermedio');
    expect(await driver.query('SELECT * FROM movements;')).toEqual(before);
    for (const table of ['buyers', 'operations', 'operation_items', 'raffle_numbers', 'movement_numbers'])
      expect(await driver.query(`SELECT COUNT(*) AS n FROM ${table};`)).toEqual([{ n: 0 }]);
  });
  it('revierte pago, limpieza y corrección si falla el historial', async () => {
    await assign([1, 2]); const reserved = await numbers([1, 2]);
    await driver.execute("CREATE TRIGGER reject_history BEFORE INSERT ON movements BEGIN SELECT RAISE(ABORT,'fallo de historial'); END;");
    await expect(catalog.operations.pay(id, reserved)).rejects.toThrow('fallo de historial'); expect(await numbers([1, 2])).toEqual(reserved);
    await expect(catalog.operations.clear(id, reserved, 'Prueba')).rejects.toThrow('fallo de historial'); expect(await numbers([1, 2])).toEqual(reserved);
    const another = { kind: 'new' as const, input: { ...((buyer as Extract<BuyerChoice, {kind:'new'}>).input), firstName: 'Luis' } };
    await expect(catalog.operations.correctBuyer(id, reserved[0]!, another, 'Error de asignación')).rejects.toThrow('fallo de historial');
    expect(await numbers([1, 2])).toEqual(reserved); expect(await catalog.listBuyers()).toHaveLength(1);
  });
  it('libera una reserva sin borrar historia y rechaza un formulario viejo aunque vuelva a estar libre', async () => {
    const old = await catalog.operations.number(id, 1); await assign([1, 2]);
    await catalog.operations.clear(id, await numbers([1]), 'Canceló la reserva');
    const n = await catalog.operations.number(id, 1); expect(n.status).toBe('disponible'); expect(n.buyerId).toBeNull(); expect(n.revision).toBe(2);
    const b = await catalog.operations.board(id);
    await expect(catalog.operations.assign(id, b.revision, [old], buyer, 'venta')).rejects.toThrow('cambió');
    await assign([1], 'venta'); expect((await catalog.operations.history(id, 1)).map(h => h.action)).toEqual(['venta', 'limpiar', 'reserva']);
    expect((await catalog.operations.number(id, 2)).status).toBe('reservado');
  });
  it('exige advertencia de devolución al anular una venta y ajusta recaudación', async () => {
    await assign([1, 2], 'venta'); const selection = await numbers([1]);
    await expect(catalog.operations.clear(id, selection, 'Error')).rejects.toThrow('devolución');
    await expect(catalog.operations.clear(id, selection, ' ', true)).rejects.toThrow('motivo');
    await catalog.operations.clear(id, selection, 'Venta anulada, revisar devolución', true);
    const b = await catalog.operations.board(id); expect([b.sold, b.available, b.collectedCents]).toEqual([1, 99, 150050]);
    expect((await catalog.operations.history(id, 1))[0]!.beforeJson).toContain('vendido');
    expect(await driver.query("SELECT COUNT(*) AS n FROM operation_items WHERE status='cancelado';")).toEqual([{ n: 1 }]);
  });
  it('corrige solo el comprador elegido conservando el precio, pago y el resto del grupo', async () => {
    await assign([1, 2], 'venta'); const original = await numbers([1, 2]);
    const buyerId = await catalog.saveBuyer({ phone: '222', firstName: 'Luis', lastName: 'Otro', email: null, notes: '' });
    await catalog.operations.correctBuyer(id, original[0]!, { kind: 'existing', id: buyerId }, 'Se eligió la ficha equivocada');
    const changed = await numbers([1, 2]); expect(changed[0]!.buyerId).toBe(buyerId); expect(changed[0]!.status).toBe('vendido');
    expect(changed[0]!.unitPriceCents).toBe(original[0]!.unitPriceCents); expect(changed[1]).toEqual(original[1]);
    expect((await catalog.operations.board(id)).collectedCents).toBe(300100);
    expect((await catalog.operations.history(id, 1))[0]!.beforeJson).toContain('Ana Prueba');
    expect((await catalog.operations.history(id, 1))[0]!.afterJson).toContain('Luis Otro');
  });
  it('bloquea altas en pausa, permite gestión pendiente y bloquea todo con ventas cerradas', async () => {
    await assign([1]); const d = await catalog.getRaffle(id); await catalog.setSalesState(id, d.revision, 'pausado');
    await expect(assign([2])).rejects.toThrow('reanudá'); await catalog.operations.pay(id, await numbers([1]));
    await driver.run("UPDATE raffles SET status='ventas_cerradas' WHERE id=?;", [id]);
    await expect(catalog.operations.clear(id, await numbers([1]), 'Error', true)).rejects.toThrow('no admite');
    await expect(catalog.operations.pay(id, await numbers([1]))).rejects.toThrow('no admite');
  });
  it('no permite ampliar rango ni modificar precio después de limpiar todas las operaciones', async () => {
    await assign([1]); await catalog.operations.clear(id, await numbers([1]), 'Cancelación');
    const value = await catalog.getRaffle(id); value.raffle.unitPriceCents = 1;
    await expect(catalog.saveRaffle(value)).rejects.toThrow('operaciones');
  });
  it('marca imagen desactualizada sin generar recursos', async () => {
    await driver.run('UPDATE graphic_configurations SET dirty=0,generated_at=? WHERE raffle_id=?;', ['2026-01-01', id]);
    await assign([1]); expect((await catalog.operations.board(id)).imageDirty).toBe(true);
    expect(await driver.query('SELECT COUNT(*) AS n FROM resources;')).toEqual([{ n: 0 }]);
  });
  it('pagina un millón de números sin materializar filas y respeta rangos negativos y extremos', async () => {
    const large = fixture(1_000_000); large.raffle.startNumber = -50;
    const saved = await catalog.saveRaffle(large); const b = await catalog.operations.board(saved.raffle.id, 999900);
    expect(b.numbers).toHaveLength(100); expect(b.numbers[0]!.value).toBe(999850); expect(b.numbers.at(-1)!.value).toBe(999949);
    expect(await driver.query('SELECT COUNT(*) AS n FROM raffle_numbers;')).toEqual([{ n: 0 }]);
    const limit = fixture(1); limit.raffle.startNumber = Number.MAX_SAFE_INTEGER;
    const last = await catalog.saveRaffle(limit); expect((await catalog.operations.board(last.raffle.id)).numbers[0]!.value).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('historial paginado no mezcla sorteos y conserva los vínculos inmutables', async () => {
    for (let i = 0; i < 32; i++) await assign([i]);
    const first = await catalog.operations.history(id); const second = await catalog.operations.history(id, undefined, first.at(-1)!.sequence);
    expect(first).toHaveLength(30); expect(second.length).toBeGreaterThan(0); expect(new Set([...first, ...second].map(h => h.id)).size).toBe(first.length + second.length);
    const other = await active(catalog); expect(await catalog.operations.history(other.raffle.id, 1)).toEqual([]);
    await expect(driver.run('DELETE FROM movement_numbers;')).rejects.toThrow('inmutable');
  });
  it('migra datos operativos de esquema 2 y preserva vínculos al reabrir un archivo', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'operations-')); let fileDb: Database | undefined;
    try {
      const path = join(folder, 'app.sqlite'); const old = new NodeDriver(path); await migrate(old, migrations.slice(0, 2));
      const r = fixture().raffle; r.status = 'activo'; await insertRaffle(old, r);
      await old.run("INSERT INTO buyers (id,phone,phone_key,first_name,last_name,created_at,updated_at) VALUES ('b','123','123','Ana','Prueba','now','now');");
      await old.run("INSERT INTO operations (id,raffle_id,buyer_id,type,status,amount_cents,created_at,updated_at) VALUES ('op',?,'b','reserva','vigente',0,'now','now');", [r.id]);
      await old.run("INSERT INTO raffle_numbers (id,raffle_id,value,status,buyer_id,active_operation_id) VALUES ('n',?,17,'reservado','b','op');", [r.id]);
      await old.run("INSERT INTO operation_items VALUES ('op','n',?,150050,'reservado');", [r.id]);
      await migrate(old); fileDb = new Database(old); const first = new CatalogService(fileDb, 'android');
      const n = await first.operations.number(r.id, 17); expect(n.operationId).toBe('op'); await first.operations.pay(r.id, [n]);
      const before = await first.operations.board(r.id); const history = await first.operations.history(r.id, 17);
      await fileDb.close(); fileDb = undefined;
      const fresh = new NodeDriver(path); await migrate(fresh); fileDb = new Database(fresh); const reopened = new CatalogService(fileDb, 'android');
      expect(await reopened.operations.board(r.id)).toEqual(before); expect(await reopened.operations.history(r.id, 17)).toEqual(history);
      expect(await fresh.query('PRAGMA foreign_key_check;')).toEqual([]);
    } finally { await fileDb?.close(); await rm(folder, { recursive: true }); }
  });
});
function neverBuyer(): never { throw new Error('Expected new buyer fixture'); }
