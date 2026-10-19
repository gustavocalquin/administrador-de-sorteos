import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogService } from '../../src/application/catalog-service';
import { newRaffle } from '../../src/domain/catalog';
import { Database } from '../../src/infrastructure/database/driver';
import { migrate } from '../../src/infrastructure/database/migrate';
import { NodeDriver } from '../helpers/node-driver';

it('recorrido completo: conserva cierre, resultados, respaldo e historial al reabrir un archivo SQLite', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sorteos-release-'));
  const file = join(folder, 'datos.sqlite');
  let db: Database | undefined;
  async function open() {
    const driver = new NodeDriver(file); await migrate(driver);
    db = new Database(driver); return new CatalogService(db, 'preview');
  }
  try {
    let service = await open();
    const input = newRaffle();
    Object.assign(input.raffle, { name: 'Regresión integral', publicContact: 'Club de prueba', drawMethod: 'Presencial', quantity: 50, unitPriceCents: 125050 });
    input.prizes[0]!.description = 'Premio de prueba';
    const saved = await service.saveRaffle(input); const id = saved.raffle.id;
    const rev = async () => (await service.getRaffle(id)).revision;
    await service.setSalesState(id, await rev(), 'activo');
    const buyerId = await service.saveBuyer({ phone: '1100000123', firstName: 'Ana', lastName: 'Privada', email: null, notes: 'No publicar' });
    const siblingId = await service.saveBuyer({ phone: '1100000123', firstName: 'Luis', lastName: 'Privado', email: null, notes: '' });
    await service.operations.assign(id, await rev(), [{ value: 1, revision: 0 }, { value: 2, revision: 0 }], { kind: 'existing', id: buyerId }, 'reserva');
    await service.operations.pay(id, [await service.operations.number(id, 1)]);
    await service.operations.assign(id, await rev(), [{ value: 3, revision: 0 }], { kind: 'existing', id: siblingId }, 'venta');
    const publicData = JSON.stringify(await service.graphics.snapshot(id));
    for (const privateText of ['1100000123', 'Privada', 'Privado', 'No publicar', buyerId, siblingId]) expect(publicData).not.toContain(privateText);
    await service.closing.close(id, await rev(), true);
    await service.closing.record(id, await rev(), saved.prizes[0]!.id, 1);
    await service.closing.archive(id, await rev());
    const before = await service.operations.board(id);
    const history = await service.operations.history(id);
    const closing = await service.closing.view(id);
    expect(before).toMatchObject({ sold: 2, reserved: 0, available: 48, collectedCents: 250100 });
    expect(closing.results[0]?.buyer?.id).toBe(buyerId);
    const password = 'respaldo-de-regresion-2026';
    const backup = await service.backups.create(password);
    await db!.close(); db = undefined; service = await open();
    expect(await service.operations.board(id)).toEqual(before);
    expect(await service.operations.history(id)).toEqual(history);
    expect(await service.closing.view(id)).toEqual(closing);
    expect((await service.listBuyers('1100000123')).map(b => b.id).sort()).toEqual([buyerId, siblingId].sort());
    await service.duplicateRaffle(id);
    const preview = await service.backups.preview(backup.file, password);
    await service.backups.restore(preview.token, 'REEMPLAZAR');
    await db!.close(); db = undefined; service = await open();
    expect(await service.listRaffles()).toHaveLength(1);
    expect(await service.operations.history(id)).toEqual(history);
    expect(await service.closing.view(id)).toEqual(closing);
    const recovery = await service.backups.previewRecovery(); expect(recovery.raffles).toBe(2);
    service.backups.discardPreview();
    await expect(service.closing.reopen(id, await rev())).rejects.toThrow();
    await expect(db!.transaction(tx => tx.execute('DELETE FROM movements;'))).rejects.toThrow('inmutable');
  } finally {
    await db?.close();
    await rm(folder, { recursive: true });
  }
});
