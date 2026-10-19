import { afterEach, beforeEach, expect, it } from 'vitest';
import { CatalogService } from '../../src/application/catalog-service';
import { newRaffle } from '../../src/domain/catalog';
import { Database } from '../../src/infrastructure/database/driver';
import { migrate } from '../../src/infrastructure/database/migrate';
import { NodeDriver } from '../helpers/node-driver';

let db: Database;
let service: CatalogService;
const png = 'data:image/png;base64,iVBORw0KGgo=';
const png2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';

beforeEach(async () => {
  const driver = new NodeDriver();
  await migrate(driver);
  db = new Database(driver);
  service = new CatalogService(db, 'preview');
});
afterEach(async () => db.close());

async function raffle(name: string) {
  const value = newRaffle();
  Object.assign(value.raffle, { name, publicContact: 'Club', drawMethod: 'Presencial', quantity: 10, unitPriceCents: 10000 });
  value.prizes[0]!.description = 'Premio';
  value.image = png;
  return service.saveRaffle(value);
}

it('borra todos los datos propios del sorteo y conserva compradores y otros sorteos', async () => {
  let target = await raffle('Para borrar');
  const other = await raffle('Conservar');
  const oldResource = String((await db.read(tx => tx.query('SELECT original_resource_id FROM graphic_configurations WHERE raffle_id=?;', [target.raffle.id])))[0]!.original_resource_id);
  target.image = png2;
  target = await service.saveRaffle(target);
  target = await service.setSalesState(target.raffle.id, target.revision, 'activo');
  await service.operations.assign(target.raffle.id, target.revision, [await service.operations.number(target.raffle.id, 1)],
    { kind: 'new', input: { phone: '110001', firstName: 'Ana', lastName: 'Prueba', email: null, notes: '' } }, 'venta');
  target = await service.getRaffle(target.raffle.id);
  await service.graphics.save(target.raffle.id, target.revision, [
    { kind: 'grid', title: 'Grilla', dataUrl: png2 }, { kind: 'conditions', title: 'Bases', dataUrl: png2 },
  ]);
  await service.closing.close(target.raffle.id, target.revision, true);
  target = await service.getRaffle(target.raffle.id);
  await service.closing.record(target.raffle.id, target.revision, target.prizes[0]!.id, 1);

  await service.deleteRaffle(target.raffle.id);

  expect((await service.listRaffles()).map(item => item.id)).toEqual([other.raffle.id]);
  expect(await service.listBuyers()).toHaveLength(1);
  expect(await db.read(tx => tx.query('SELECT * FROM raffles WHERE id=?;', [target.raffle.id]))).toHaveLength(0);
  for (const table of ['prizes', 'graphic_configurations', 'raffle_numbers', 'operations', 'operation_items', 'movement_numbers', 'generated_sets', 'closures', 'draws', 'results']) {
    expect(await db.read(tx => tx.query(`SELECT * FROM ${table} WHERE raffle_id=?;`, [target.raffle.id]))).toHaveLength(0);
  }
  expect(await db.read(tx => tx.query("SELECT * FROM movements WHERE entity_type='sorteo' AND entity_id=?;", [target.raffle.id]))).toHaveLength(0);
  expect(await db.read(tx => tx.query('SELECT * FROM resources WHERE id=?;', [oldResource]))).toHaveLength(0);
  expect(await db.read(tx => tx.query('PRAGMA foreign_key_check;'))).toHaveLength(0);
  expect(await db.read(tx => tx.query("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('movements_no_delete','movement_numbers_no_delete','closures_no_delete','draws_no_delete');"))).toHaveLength(4);
});

it('revierte la eliminación completa y restaura las protecciones si SQLite falla', async () => {
  const target = await raffle('Intacto');
  await db.read(tx => tx.execute("CREATE TRIGGER fail_raffle_delete BEFORE DELETE ON raffles BEGIN SELECT RAISE(ABORT,'fallo inducido'); END;"));

  await expect(service.deleteRaffle(target.raffle.id)).rejects.toThrow('fallo inducido');

  expect((await service.getRaffle(target.raffle.id)).raffle.name).toBe('Intacto');
  expect(await db.read(tx => tx.query("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('movements_no_delete','movement_numbers_no_delete','closures_no_delete','draws_no_delete');"))).toHaveLength(4);
  await expect(db.read(tx => tx.run("DELETE FROM movements WHERE entity_type='sorteo' AND entity_id=?;", [target.raffle.id]))).rejects.toThrow('inmutable');
});
