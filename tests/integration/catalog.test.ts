import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogService } from '../../src/application/catalog-service';
import { money, newRaffle, parseInteger, parsePrice, priceInput, type RaffleDetails } from '../../src/domain/catalog';
import { Database } from '../../src/infrastructure/database/driver';
import { migrate, migrations } from '../../src/infrastructure/database/migrate';
import { NodeDriver } from '../helpers/node-driver';
import { diagnosticRaffle } from '../../src/dev/diagnostic-service';
import { insertRaffle } from '../../src/infrastructure/database/repositories/raffles';

function sample(): RaffleDetails {
  const value = newRaffle();
  Object.assign(value.raffle, { name: 'Club', publicContact: 'Club · 1234', drawMethod: 'Presencial',
    startNumber: -5, quantity: 100, unitPriceCents: 125050 });
  value.prizes[0]!.description = 'Bicicleta';
  value.prizes.push({ id: crypto.randomUUID(), raffleId: value.raffle.id, position: 2, description: 'Canasta' });
  return value;
}
const person = { phone: '+54 (11) 2222-3333', firstName: 'Ana María', lastName: 'Pérez', email: null, notes: '' };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Y7sAAAAASUVORK5CYII=';
const png2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
describe('Etapa 2: catálogo transaccional en SQLite real', () => {
  let driver: NodeDriver; let db: Database; let service: CatalogService;
  beforeEach(async () => { driver = new NodeDriver(); await migrate(driver); db = new Database(driver); service = new CatalogService(db, 'android'); });
  afterEach(async () => { await db.close(); });
  it('guarda y edita premios ordenados, fecha, regla y presentación con historial', async () => {
    const input = sample(); input.raffle.participants = 'todos'; input.raffle.unsoldRule = 'El premio queda vacante si sale un número sin comprador.';
    input.raffle.drawAt = '2027-02-20T21:30:00.000Z'; input.template = 'festiva'; input.palette = 'ciruela';
    const saved = await service.saveRaffle(input);
    expect(saved.revision).toBe(1); expect(saved.raffle.drawAt).toBe(input.raffle.drawAt);
    saved.prizes.reverse(); saved.prizes[0]!.description = 'Canasta especial'; saved.raffle.quantity = 50;
    const edited = await service.saveRaffle(saved);
    expect(edited.prizes.map(p => [p.position, p.description])).toEqual([[1, 'Canasta especial'], [2, 'Bicicleta']]);
    expect(edited.palette).toBe('ciruela'); expect(edited.revision).toBe(2);
    expect(await driver.query('SELECT action FROM movements ORDER BY rowid;')).toEqual([{ action: 'crear' }, { action: 'editar_configuracion' }]);
  });
  it('revierte sorteo, premios y cambios si falla la escritura del historial', async () => {
    const saved = await service.saveRaffle(sample());
    await driver.execute("CREATE TRIGGER reject_audit BEFORE INSERT ON movements BEGIN SELECT RAISE(ABORT, 'fallo inducido'); END;");
    const edit = structuredClone(saved); edit.raffle.name = 'No guardar'; edit.prizes.reverse();
    await expect(service.saveRaffle(edit)).rejects.toThrow('fallo inducido');
    expect(await service.getRaffle(saved.raffle.id)).toEqual(saved);
    await expect(service.saveRaffle(sample())).rejects.toThrow('fallo inducido');
    expect(await service.listRaffles()).toHaveLength(1);
    await expect(service.saveBuyer(person)).rejects.toThrow('fallo inducido');
    expect(await service.listBuyers()).toHaveLength(0);
  });
  it('rechaza configuraciones incompletas e importes/rangos imposibles sin escrituras', async () => {
    for (const mutate of [
      (v: RaffleDetails) => { v.raffle.quantity = 0; },
      (v: RaffleDetails) => { v.raffle.startNumber = Number.MAX_SAFE_INTEGER; },
      (v: RaffleDetails) => { v.raffle.unitPriceCents = 1.5; },
      (v: RaffleDetails) => { v.prizes = []; },
      (v: RaffleDetails) => { v.raffle.participants = 'todos'; },
      (v: RaffleDetails) => { v.raffle.drawAt = 'invalid'; },
      (v: RaffleDetails) => { v.image = 'https://example.com/imagen.png'; },
    ]) { const value = sample(); mutate(value); await expect(service.saveRaffle(value)).rejects.toThrow(); }
    expect(await service.listRaffles()).toHaveLength(0);
  });
  it('impide sobreescrituras de formularios viejos y guardados dobles concurrentes', async () => {
    const value = sample(); const results = await Promise.allSettled([service.saveRaffle(value), service.saveRaffle(value)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const old = await service.getRaffle(value.raffle.id); const edited = await service.saveRaffle(old);
    await expect(service.saveRaffle(old)).rejects.toThrow('cambiaron'); expect(edited.revision).toBe(2);
  });
  it('bloquea cambios comprometidos incluso tras anulación, permite contacto y estilo', async () => {
    const saved = await service.saveRaffle(sample()); const buyerId = await service.saveBuyer(person);
    await driver.run("INSERT INTO operations (id,raffle_id,buyer_id,type,status,amount_cents,created_at,updated_at) VALUES ('op',?,?,'reserva','anulada',0,'now','now');", [saved.raffle.id, buyerId]);
    for (const mutate of [
      (v: RaffleDetails) => { v.raffle.quantity++; },
      (v: RaffleDetails) => { v.raffle.startNumber++; },
      (v: RaffleDetails) => { v.raffle.unitPriceCents++; },
      (v: RaffleDetails) => { v.prizes.reverse(); },
      (v: RaffleDetails) => { v.raffle.drawMethod = 'Otro'; },
    ]) { const v = structuredClone(saved); mutate(v); await expect(service.saveRaffle(v)).rejects.toThrow('operaciones'); }
    saved.raffle.publicContact = 'Nuevo contacto'; saved.template = 'moderna';
    expect((await service.saveRaffle(saved)).locked).toBe(true);
  });
  it('guarda logo y una foto por premio, y permite actualizar fotos después de operar', async () => {
    const input = sample(); input.image = png; input.prizes[0]!.image = png2;
    let saved = await service.saveRaffle(input);
    expect(saved.image).toBe(png); expect(saved.prizes[0]!.image).toBe(png2); expect(saved.prizes[1]!.image).toBeNull();
    saved = await service.setSalesState(saved.raffle.id, saved.revision, 'activo');
    await service.operations.assign(saved.raffle.id, saved.revision, [{ value: -5, revision: 0 }],
      { kind: 'new', input: person }, 'reserva');
    saved = await service.getRaffle(saved.raffle.id); saved.prizes[0]!.image = png;
    const edited = await service.saveRaffle(saved);
    expect(edited.locked).toBe(true); expect(edited.prizes[0]!.image).toBe(png);
    edited.prizes[0]!.description = 'No permitido';
    await expect(service.saveRaffle(edited)).rejects.toThrow('operaciones');
  });
  it('duplica configuración con IDs nuevos sin copiar operaciones ni números', async () => {
    const saved = await service.saveRaffle(sample());
    const active = await service.setSalesState(saved.raffle.id, saved.revision, 'activo');
    await driver.run("INSERT INTO raffle_numbers (id,raffle_id,value,status) VALUES ('n',?,-5,'disponible');", [saved.raffle.id]);
    const copy = await service.duplicateRaffle(active.raffle.id);
    expect(copy.raffle.id).not.toBe(saved.raffle.id); expect(copy.raffle.status).toBe('borrador'); expect(copy.locked).toBe(false);
    expect(copy.prizes.map(p => p.description)).toEqual(saved.prizes.map(p => p.description));
    expect(copy.prizes[0]!.id).not.toBe(saved.prizes[0]!.id);
    expect(await driver.query('SELECT id FROM raffle_numbers WHERE raffle_id=?;', [copy.raffle.id])).toEqual([]);
    expect(await driver.query('SELECT id FROM operations WHERE raffle_id=?;', [copy.raffle.id])).toEqual([]);
  });
  it('activa, pausa y reanuda con historial y rechaza transición inválida', async () => {
    let saved = await service.saveRaffle(sample());
    await expect(service.setSalesState(saved.raffle.id, saved.revision, 'pausado')).rejects.toThrow('estado');
    for (const state of ['activo', 'pausado', 'activo'] as const) {
      saved = await service.setSalesState(saved.raffle.id, saved.revision, state); expect(saved.raffle.status).toBe(state);
    }
    await driver.run("UPDATE raffles SET status='ventas_cerradas' WHERE id=?;", [saved.raffle.id]);
    await expect(service.saveRaffle(saved)).rejects.toThrow('edición');
    await expect(service.setSalesState(saved.raffle.id, saved.revision, 'activo')).rejects.toThrow('estado');
  });
  it('comparte teléfono, normaliza búsquedas y mantiene la misma identidad al editar', async () => {
    const id = await service.saveBuyer(person);
    await service.saveBuyer({ ...person, firstName: 'Luis', phone: '54 11 22223333' });
    expect(await service.listBuyers(' +54 (11) 2222-3333 ')).toHaveLength(2);
    const found = (await service.listBuyers(' PE REZ ANAMARIA '))[0]!;
    expect(found.id).toBe(id); expect(found.phoneKey).toBe('541122223333');
    await service.saveBuyer({ ...found, lastName: 'Gómez' }, found);
    expect((await service.listBuyers('gomez'))[0]!.id).toBe(id); expect(await service.listBuyers()).toHaveLength(2);
    await expect(service.saveBuyer(found, found)).rejects.toThrow('cambiaron');
    for (const input of [{ ...person, phone: 'abc' }, { ...person, firstName: '' }, { ...person, lastName: '' }, { ...person, email: 'incorrecto' }])
      await expect(service.saveBuyer(input)).rejects.toThrow();
  });
  it('encuentra por número asignado y reutiliza comprador en dos sorteos', async () => {
    const buyerId = await service.saveBuyer(person);
    for (const input of [sample(), sample()]) {
      const saved = await service.saveRaffle(input); const op = crypto.randomUUID();
      await driver.run("INSERT INTO operations (id,raffle_id,buyer_id,type,status,amount_cents,created_at,updated_at) VALUES (?,?,?,'venta','completada',125050,'now','now');", [op, saved.raffle.id, buyerId]);
      await driver.run("INSERT INTO raffle_numbers (id,raffle_id,value,status,buyer_id,active_operation_id) VALUES (?,?,17,'vendido',?,?);", [crypto.randomUUID(), saved.raffle.id, buyerId, op]);
    }
    expect((await service.listBuyers('17')).map(b => b.id)).toEqual([buyerId]);
    expect(await service.listBuyers()).toHaveLength(1);
  });
  it('migra etapa 1 preservando UUID, valores y agregando apariencia predeterminada', async () => {
    const old = new NodeDriver();
    try {
      await migrate(old, migrations.slice(0, 1)); const value = diagnosticRaffle(); await insertRaffle(old, value);
      await migrate(old);
      const migrated = await new CatalogService(new Database(old), 'android').getRaffle(value.id);
      expect(migrated.raffle).toEqual(value); expect(migrated.revision).toBe(1); expect(migrated.palette).toBe('bosque');
      expect(await old.query('PRAGMA foreign_key_check;')).toEqual([]);
    } finally { await old.close(); }
  });
  it('migra 5→7 conservando el logo, agregando fotos vacías y habilitando las plantillas nuevas', async () => {
    const old = new NodeDriver();
    try {
      await migrate(old, migrations.slice(0, 5)); const raffle = diagnosticRaffle(); await insertRaffle(old, raffle);
      await old.run('INSERT INTO resources(id,data_url,created_at) VALUES (?,?,?);', ['logo', png, 'hoy']);
      await old.run("INSERT INTO graphic_configurations(raffle_id,template,palette,original_resource_id,conditions_notes,dirty) VALUES (?,'clasica','bosque','logo','',1);", [raffle.id]);
      await old.run("INSERT INTO prizes(id,raffle_id,position,description) VALUES ('premio',?,1,'Bicicleta');", [raffle.id]);
      await migrate(old);
      const migrated = await new CatalogService(new Database(old), 'android').getRaffle(raffle.id);
      expect(migrated.image).toBe(png); expect(migrated.prizes[0]!.image).toBeNull();
      expect((await old.query('PRAGMA user_version;'))[0]!.user_version).toBe(7);
      await old.run("UPDATE graphic_configurations SET template='elegante' WHERE raffle_id=?;", [raffle.id]);
      expect((await old.query('SELECT template FROM graphic_configurations WHERE raffle_id=?;', [raffle.id]))[0]!.template).toBe('elegante');
    } finally { await old.close(); }
  });
  it('persiste sorteo completo, imagen y comprador al cerrar y reabrir archivo', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'catalog-test-')); let fileDb: Database | undefined;
    try {
      const path = join(folder, 'sorteos.sqlite'); const first = new NodeDriver(path); await migrate(first); fileDb = new Database(first);
      const catalog = new CatalogService(fileDb, 'android'); const value = sample();
      value.image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
      const saved = await catalog.saveRaffle(value); await catalog.saveBuyer(person); const buyers = await catalog.listBuyers();
      await fileDb.close(); fileDb = undefined;
      const second = new NodeDriver(path); await migrate(second); fileDb = new Database(second);
      const reopened = new CatalogService(fileDb, 'android');
      expect(await reopened.getRaffle(saved.raffle.id)).toEqual(saved); expect(await reopened.listBuyers()).toEqual(buyers);
    } finally { await fileDb?.close(); await rm(folder, { recursive: true }); }
  });
  it('interpreta centavos exactos y rechaza notación ambigua o exponencial', () => {
    expect(parsePrice('1500,50')).toBe(150050); expect(parsePrice('0.01')).toBe(1); expect(parseInteger('-5')).toBe(-5);
    expect(parsePrice('90071992547409,91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(priceInput(Number.MAX_SAFE_INTEGER)).toBe('90071992547409,91');
    expect(money(Number.MAX_SAFE_INTEGER)).toContain('90.071.992.547.409,91');
    expect(() => parsePrice('90071992547409,92')).toThrow();
    for (const invalid of ['1.500,50', '-1', '1e3', '1,234', '', 'Infinity']) expect(() => parsePrice(invalid)).toThrow();
    for (const invalid of ['1.5', '1e3', '9007199254740992']) expect(() => parseInteger(invalid)).toThrow();
  });
});
