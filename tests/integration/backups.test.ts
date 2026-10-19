import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { CatalogService } from '../../src/application/catalog-service';
import { newRaffle } from '../../src/domain/catalog';
import { Database } from '../../src/infrastructure/database/driver';
import { migrate } from '../../src/infrastructure/database/migrate';
import { decryptBackup,encryptBackup } from '../../src/infrastructure/backup/crypto';
import { NodeDriver } from '../helpers/node-driver';
const password = 'frase-de-prueba-única';
let db: Database; let service: CatalogService; let id: string;
beforeEach(async () => {
  const driver = new NodeDriver(); await migrate(driver); db = new Database(driver); service = new CatalogService(db,'preview');
  const r = newRaffle(); Object.assign(r.raffle,{name:'Sorteo secreto',publicContact:'Club',drawMethod:'Presencial'}); r.prizes[0]!.description = 'Premio';
  id = (await service.saveRaffle(r)).raffle.id;
  await service.saveBuyer({phone:'119999',firstName:'Privado',lastName:'Comprador',email:null,notes:'Nota confidencial'});
});
afterEach(async () => { vi.restoreAllMocks(); await db.close(); });
it('cifra con sal/IV distintos, no expone datos y rechaza contraseña o alteración', async () => {
  const a = await service.backups.create(password); const b = await service.backups.create(password);
  expect(a.file).not.toBe(b.file); expect(a.file).not.toContain('Sorteo secreto'); expect(a.file).not.toContain('119999'); expect(a.file).not.toContain(password);
  await expect(service.backups.preview(a.file,'contraseña equivocada')).rejects.toThrow('Contraseña incorrecta');
  const broken = JSON.parse(a.file); broken.data = (broken.data[0] === 'A' ? 'B' : 'A') + broken.data.slice(1);
  await expect(service.backups.preview(JSON.stringify(broken),password)).rejects.toThrow();
  expect(await service.listRaffles()).toHaveLength(1);
  await expect(service.backups.create('corta')).rejects.toThrow('12');
});
it('vista previa no modifica datos; reemplazo total crea resguardo recuperable', async () => {
  const backup = await service.backups.create(password);
  await service.duplicateRaffle(id); expect(await service.listRaffles()).toHaveLength(2);
  const preview = await service.backups.preview(backup.file,password); expect(preview.raffles).toBe(1);
  expect(await service.listRaffles()).toHaveLength(2);
  await expect(service.backups.restore(preview.token,'')).rejects.toThrow('REEMPLAZAR');
  await service.backups.restore(preview.token,'REEMPLAZAR'); expect(await service.listRaffles()).toHaveLength(1);
  const recovery = await service.backups.previewRecovery(); expect(recovery.raffles).toBe(2);
  await service.backups.restore(recovery.token,'REEMPLAZAR'); expect(await service.listRaffles()).toHaveLength(2);
  await expect(db.transaction(tx => tx.run('DELETE FROM movements;'))).rejects.toThrow('inmutable');
});
it('restauración con fallo a mitad revierte datos y resguardo', async () => {
  const backup = await service.backups.create(password); await service.duplicateRaffle(id);
  const preview = await service.backups.preview(backup.file,password);
  await db.read(tx => tx.execute("CREATE TRIGGER fail_restore BEFORE INSERT ON buyers BEGIN SELECT RAISE(ABORT,'fallo restauración'); END;"));
  await expect(service.backups.restore(preview.token,'REEMPLAZAR')).rejects.toThrow('fallo restauración');
  expect(await service.listRaffles()).toHaveLength(2); expect(await service.listBuyers()).toHaveLength(1);
  expect((await service.backups.status()).recoveryAt).toBeNull();
  await expect(db.transaction(tx => tx.run('DELETE FROM movements;'))).rejects.toThrow('inmutable');
});
it('rechaza estructura, versión futura y referencias rotas antes de ofrecer restaurar', async () => {
  const backup = await service.backups.create(password); const original = JSON.parse(await decryptBackup(backup.file,password));
  const future = structuredClone(original); future.schema = 99;
  await expect(service.backups.preview(await encryptBackup(JSON.stringify(future),password),password)).rejects.toThrow('Versión');
  const broken = structuredClone(original); broken.tables.prizes[0].raffle_id = 'ausente';
  await expect(service.backups.preview(await encryptBackup(JSON.stringify(broken),password),password)).rejects.toThrow();
  const malformed = structuredClone(original); malformed.tables.buyers[0].unexpected = 'SQL no ejecutable';
  await expect(service.backups.preview(await encryptBackup(JSON.stringify(malformed),password),password)).rejects.toThrow('Estructura');
  expect(await service.listRaffles()).toHaveLength(1); expect(await service.listBuyers()).toHaveLength(1);
});
it('rechaza una confirmación si hubo cambios después de la vista previa', async () => {
  const backup = await service.backups.create(password); const preview = await service.backups.preview(backup.file,password);
  await service.duplicateRaffle(id);
  await expect(service.backups.restore(preview.token,'REEMPLAZAR')).rejects.toThrow('cambiaron'); expect(await service.listRaffles()).toHaveLength(2);
});
it('acepta respaldos de esquema 5 y completa las fotos de premios al restaurar', async () => {
  const backup = await service.backups.create(password); const legacy = JSON.parse(await decryptBackup(backup.file,password));
  legacy.schema = 5;
  for (const prize of legacy.tables.prizes) delete prize.image_resource_id;
  const preview = await service.backups.preview(await encryptBackup(JSON.stringify(legacy),password),password);
  await service.backups.restore(preview.token,'REEMPLAZAR');
  expect((await service.getRaffle(id)).prizes[0]!.image).toBeNull();
  expect(await db.read(tx => tx.query('PRAGMA foreign_key_check;'))).toEqual([]);
});
it('acepta respaldos de esquema 6 y los actualiza al formato vigente', async () => {
  const backup = await service.backups.create(password); const legacy = JSON.parse(await decryptBackup(backup.file,password));
  expect(legacy.schema).toBe(7); legacy.schema = 6;
  const preview = await service.backups.preview(await encryptBackup(JSON.stringify(legacy),password),password);
  await service.backups.restore(preview.token,'REEMPLAZAR');
  expect((await service.getRaffle(id)).raffle.name).toBe('Sorteo secreto');
  expect(await db.read(tx => tx.query('PRAGMA foreign_key_check;'))).toEqual([]);
});
it('respalda y restaura el logo y las fotos propias de los premios', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Y7sAAAAASUVORK5CYII=';
  let value = await service.getRaffle(id); value.image = png; value.prizes[0]!.image = png;
  value = await service.saveRaffle(value);
  const backup = await service.backups.create(password);
  value.image = null; value.prizes[0]!.image = null; await service.saveRaffle(value);
  const preview = await service.backups.preview(backup.file,password); await service.backups.restore(preview.token,'REEMPLAZAR');
  const restored = await service.getRaffle(id);
  expect(restored.image).toBe(png); expect(restored.prizes[0]!.image).toBe(png);
});
it('respalda recursos anteriores, imágenes, cierre, resultados e historial', async () => {
  await db.transaction(tx => tx.run('INSERT INTO resources(id,data_url,created_at) VALUES(?,?,?);',['original-anterior','data:image/png;base64,AAAA',new Date().toISOString()]));
  await service.setSalesState(id,1,'activo');
  await service.operations.assign(id,2,[{value:1,revision:0}],{kind:'existing',id:(await service.listBuyers())[0]!.id},'venta');
  await service.closing.close(id,3,true); await service.closing.record(id,4,(await service.getRaffle(id)).prizes[0]!.id,1);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Y7sAAAAASUVORK5CYII=';
  await service.graphics.save(id,5,[{kind:'grid',title:'Grilla',dataUrl:png},{kind:'conditions',title:'Bases',dataUrl:png}]);
  const backup = await service.backups.create(password); const content = JSON.parse(await decryptBackup(backup.file,password));
  expect(content.tables.resources).toHaveLength(1); expect(content.tables.closures).toHaveLength(1); expect(content.tables.draws).toHaveLength(1);
  expect(content.tables.generated_images).toHaveLength(2);
  const preview = await service.backups.preview(backup.file,password); await service.backups.restore(preview.token,'REEMPLAZAR');
  expect((await service.closing.view(id)).results[0]?.buyer?.firstName).toBe('Privado');
  expect((await service.graphics.get(id))?.images.map(i => i.dataUrl)).toEqual([png,png]);
  expect((await service.operations.history(id)).length).toBeGreaterThan(3);
});
it('recordatorio solo tras una semana y con cambios desde exportación confirmada', async () => {
  const backup = await service.backups.create(password); await service.backups.markExported(backup.fingerprint);
  const now = Date.now(); vi.spyOn(Date,'now').mockReturnValue(now+8*86400000);
  expect((await service.backups.status()).reminder).toBe(false);
  await service.duplicateRaffle(id); expect((await service.backups.status()).reminder).toBe(true);
  vi.mocked(Date.now).mockReturnValue(now); expect((await service.backups.status()).reminder).toBe(false);
});
