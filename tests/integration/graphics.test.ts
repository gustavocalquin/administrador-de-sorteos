import { afterEach, beforeEach, expect, it } from 'vitest';
import { CatalogService } from '../../src/application/catalog-service';
import { newRaffle } from '../../src/domain/catalog';
import { publicConditions, type GraphicImage } from '../../src/domain/graphics';
import { planGraphics, wrapText, type Measure } from '../../src/graphics/renderer';
import { Database } from '../../src/infrastructure/database/driver';
import { migrate } from '../../src/infrastructure/database/migrate';
import { NodeDriver } from '../helpers/node-driver';

let db: Database; let catalog: CatalogService; let id: string;
export const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Y7sAAAAASUVORK5CYII=';
const prizePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const images: GraphicImage[] = [{ kind: 'grid', title: 'Grilla', dataUrl: png }, { kind: 'conditions', title: 'Bases', dataUrl: png }];
const measure: Measure = (text, size) => Array.from(text).length * size * 0.6;
beforeEach(async () => {
  const driver = new NodeDriver(); await migrate(driver); db = new Database(driver); catalog = new CatalogService(db, 'preview');
  const d = newRaffle(); Object.assign(d.raffle, { name: 'Rifa del club', publicContact: 'Club · 111234', drawMethod: 'Presencial', unitPriceCents: 150050 }); d.prizes[0]!.description = 'Bicicleta';
  id = (await catalog.saveRaffle(d)).raffle.id;
});
afterEach(async () => { await db.close(); });

it.each([50, 100, 500, 1000])('divide %i números sin perder, repetir ni desordenar valores', async quantity => {
  const snapshot = await catalog.graphics.snapshot(id); snapshot.quantity = quantity;
  const pages = planGraphics(snapshot, measure); const grid = pages.filter(p => p.kind === 'grid');
  const values = grid.flatMap(p => p.values); expect(values).toEqual(Array.from({ length: quantity }, (_, i) => i));
  expect(grid[0]!.values).toHaveLength(40); expect(grid.slice(1).every(p => p.values.length <= 60)).toBe(true);
  expect(pages.at(-1)!.kind).toBe('conditions');
  for (const p of pages) for (const d of p.drawings) {
    if (d.type === 'text') { expect(d.x).toBeGreaterThanOrEqual(60); expect(d.y + d.size).toBeLessThanOrEqual(1840); expect(d.x + measure(d.text, d.size)).toBeLessThanOrEqual(1010); }
    else if (d.type === 'box' && d.radius) expect(d.x + d.w).toBeLessThanOrEqual(1008);
  }
});

it('ofrece estilos nuevos persistentes y con composiciones visuales diferentes', async () => {
  const signatures = new Set<string>();
  for (const template of ['minimalista', 'elegante', 'colorida'] as const) {
    const value = await catalog.getRaffle(id); value.template = template;
    await catalog.saveRaffle(value);
    const snapshot = await catalog.graphics.snapshot(id);
    expect(snapshot.template).toBe(template);
    const first = planGraphics(snapshot, measure)[0]!;
    signatures.add(JSON.stringify(first.drawings.filter(d => d.type === 'box' && d.y < 310)));
  }
  expect(signatures.size).toBe(3);
});

it('excluye datos privados incluso con comprador y movimientos reales', async () => {
  let d = await catalog.getRaffle(id); d = await catalog.setSalesState(id, d.revision, 'activo');
  await catalog.operations.assign(id, d.revision, [{ value: 17, revision: 0 }], { kind: 'new', input: { firstName: 'SECRETO', lastName: 'PRIVADO', phone: '999888777', notes: 'NOTA PRIVADA', email: null } }, 'venta');
  const s = await catalog.graphics.snapshot(id); const all = JSON.stringify(s) + JSON.stringify(planGraphics(s, measure));
  expect(s.numbers).toEqual([{ value: 17, status: 'vendido' }]);
  for (const secret of ['SECRETO', 'PRIVADO', '999888777', 'buyerId', 'phoneKey', 'operationId']) expect(all).not.toContain(secret);
});

it('ubica el logo en el encabezado y crea piezas separadas para fotos de premios', async () => {
  const value = await catalog.getRaffle(id); value.image = png; value.prizes[0]!.image = prizePng;
  await catalog.saveRaffle(value);
  const pages = planGraphics(await catalog.graphics.snapshot(id), measure);
  const first = pages[0]!;
  expect(first.drawings).toContainEqual(expect.objectContaining({ type: 'image', source: png, y: 145 }));
  expect(first.drawings.filter(d => d.type === 'image' && d.source === prizePng)).toHaveLength(0);
  const prizes = pages.find(page => page.title.startsWith('Fotos de premios'))!;
  expect(prizes.kind).toBe('conditions');
  expect(prizes.drawings).toContainEqual(expect.objectContaining({ type: 'image', source: prizePng }));
});

it('conserva textos largos completos en bases, parte palabras extensas y rechaza exceso sin truncar grilla', async () => {
  const s = await catalog.graphics.snapshot(id); s.notes = 'Dato largo. '.repeat(250); s.description = 'x'.repeat(200);
  const pages = planGraphics(s, measure); expect(pages.filter(p => p.kind === 'conditions').length).toBeGreaterThan(1);
  const rendered = pages.filter(p => p.kind === 'conditions').flatMap(p => p.drawings.filter(d => d.type === 'text' && d.y >= 310 && d.y < 1600).map(d => d.type === 'text' ? d.text : '')).join('');
  expect(rendered.replaceAll(' ', '')).toContain(s.notes.replaceAll(' ', '').trim());
  expect(wrapText(s.description, 36, 936, measure).every(line => measure(line, 36) <= 936)).toBe(true);
  s.quantity = 1000000; expect(() => planGraphics(s, measure)).toThrow('demasiadas');
});

it('adapta columnas a números negativos y enteros largos sin salir del área segura', async () => {
  const s = await catalog.graphics.snapshot(id); s.start = -999999999999999; s.quantity = 50;
  const pages = planGraphics(s, measure); expect(pages[0]!.values).toHaveLength(8);
  expect(pages.filter(p => p.kind === 'grid').flatMap(p => p.values)).toEqual(Array.from({ length: 50 }, (_, i) => s.start + i));
  s.participants = 'todos'; s.unsoldRule = 'El premio queda vacante.'; expect(publicConditions(s).join(' ')).toContain('El premio queda vacante.');
});

it('marca vigencia al guardar, invalida por ventas, rechaza generación vieja y conserva el conjunto previo', async () => {
  const d = await catalog.getRaffle(id); await catalog.setSalesState(id, d.revision, 'activo');
  const s = await catalog.graphics.snapshot(id); const saved = await catalog.graphics.save(id, s.revision, images);
  await expect(catalog.graphics.assertCurrent(id, saved.id)).resolves.toBeUndefined(); expect((await catalog.operations.board(id)).imageDirty).toBe(false);
  await catalog.operations.assign(id, s.revision, [{ value: 1, revision: 0 }], { kind: 'new', input: { phone: '123', firstName: 'Ana', lastName: 'Test', email: null, notes: '' } }, 'reserva');
  expect((await catalog.operations.board(id)).imageDirty).toBe(true);
  await expect(catalog.graphics.assertCurrent(id, saved.id)).rejects.toThrow('desactualizada');
  await expect(catalog.graphics.save(id, s.revision, images)).rejects.toThrow('cambió');
  expect((await catalog.graphics.get(id))!.id).toBe(saved.id);
  const fresh = await catalog.graphics.snapshot(id); const next = await catalog.graphics.save(id, fresh.revision, images);
  await expect(catalog.graphics.assertCurrent(id, saved.id)).rejects.toThrow();
  await expect(catalog.graphics.assertCurrent(id, next.id)).resolves.toBeUndefined();
});

it('revierte la sustitución completa si falla una pieza y no afecta el conjunto anterior', async () => {
  const s = await catalog.graphics.snapshot(id); const saved = await catalog.graphics.save(id, s.revision, images);
  await db.read(tx => tx.execute("CREATE TRIGGER reject_image BEFORE INSERT ON generated_images WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'Sin espacio'); END;"));
  await expect(catalog.graphics.save(id, s.revision, images)).rejects.toThrow('Sin espacio');
  expect(await catalog.graphics.get(id)).toEqual(saved);
  expect(await db.read(tx => tx.query('PRAGMA foreign_key_check;'))).toEqual([]);
});

it('guarda aclaraciones con historial, protege condiciones comprometidas e invalida al pausar', async () => {
  let s = await catalog.graphics.snapshot(id); await catalog.graphics.saveNotes(id, s.revision, 'Retiro en el club.');
  s = await catalog.graphics.snapshot(id); expect(s.notes).toBe('Retiro en el club.');
  expect((await catalog.operations.history(id))[0]!.action).toBe('editar_bases');
  const set = await catalog.graphics.save(id, s.revision, images);
  let d = await catalog.getRaffle(id); d = await catalog.setSalesState(id, d.revision, 'activo');
  await expect(catalog.graphics.assertCurrent(id, set.id)).rejects.toThrow();
  await catalog.operations.assign(id, d.revision, [{ value: 2, revision: 0 }], { kind: 'new', input: { phone: '123', firstName: 'Ana', lastName: 'Test', email: null, notes: '' } }, 'venta');
  s = await catalog.graphics.snapshot(id); await expect(catalog.graphics.saveNotes(id, s.revision, 'Otra regla')).rejects.toThrow('protegidas');
});

it('rechaza conjuntos incompletos, desordenados o formato incorrecto sin borrar imágenes', async () => {
  const s = await catalog.graphics.snapshot(id); const saved = await catalog.graphics.save(id, s.revision, images);
  for (const invalid of [[], [images[0]!], [...images].reverse(), [{ ...images[0]!, dataUrl: 'data:text/html,secret' }, images[1]!]]) {
    await expect(async () => catalog.graphics.save(id, s.revision, invalid)).rejects.toThrow();
    expect((await catalog.graphics.get(id))!.id).toBe(saved.id);
  }
});

it('duplica aclaraciones de configuración sin copiar imágenes generadas ni operaciones', async () => {
  const s = await catalog.graphics.snapshot(id); await catalog.graphics.saveNotes(id, s.revision, 'Consultar al organizador.');
  const fresh = await catalog.graphics.snapshot(id); await catalog.graphics.save(id, fresh.revision, images);
  const duplicate = await catalog.duplicateRaffle(id);
  expect((await catalog.graphics.snapshot(duplicate.raffle.id)).notes).toBe('Consultar al organizador.');
  expect(await catalog.graphics.get(duplicate.raffle.id)).toBeNull();
  expect((await catalog.operations.board(duplicate.raffle.id)).available).toBe(100);
});
