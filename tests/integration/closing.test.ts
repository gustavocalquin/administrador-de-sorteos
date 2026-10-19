import { afterEach,beforeEach,expect,it } from 'vitest';
import { CatalogService } from '../../src/application/catalog-service';
import { newRaffle } from '../../src/domain/catalog';
import { unsoldRules } from '../../src/domain/closing';
import { Database } from '../../src/infrastructure/database/driver';
import { migrate,migrations } from '../../src/infrastructure/database/migrate';
import { NodeDriver } from '../helpers/node-driver';

let db: Database; let service: CatalogService; let id: string;
beforeEach(async () => {
  const driver = new NodeDriver(); await migrate(driver); db = new Database(driver); service = new CatalogService(db,'preview');
  const value = newRaffle(); Object.assign(value.raffle,{ name:'Rifa',publicContact:'Club',drawMethod:'Radio local',quantity:10,unitPriceCents:10000 });
  value.prizes[0]!.description = 'Bicicleta';
  value.prizes.push({id:crypto.randomUUID(),raffleId:value.raffle.id,position:2,description:'Pelota'});
  id = (await service.saveRaffle(value)).raffle.id;
  await service.setSalesState(id,1,'activo');
});
afterEach(async () => db.close());
const revision = async () => (await service.getRaffle(id)).revision;
async function assign(values: number[], type: 'reserva'|'venta') {
  await service.operations.assign(id,await revision(),await Promise.all(values.map(v => service.operations.number(id,v))),
    {kind:'new',input:{phone:'110001',firstName:'Ana',lastName:'Prueba',email:null,notes:''}},type);
}
async function close() { await service.closing.close(id,await revision(),true); }
async function rule(policy: keyof typeof unsoldRules) {
  const d = await service.getRaffle(id); d.raffle.participants = 'todos'; d.raffle.unsoldRule = unsoldRules[policy]; await service.saveRaffle(d);
}
it('cancela solo los impagos, congela compradores y reabre sin restaurar reservas', async () => {
  await assign([1,2,3],'reserva'); await service.operations.pay(id,[await service.operations.number(id,1)]);
  await expect(service.closing.close(id,await revision(),false)).rejects.toThrow('Confirmá');
  await close(); const view = await service.closing.view(id);
  expect(view.closure?.snapshot.sold.map(n => n.value)).toEqual([1]);
  expect((await service.operations.board(id)).reserved).toBe(0);
  expect((await service.operations.number(id,2)).buyerId).toBeNull();
  const buyer = (await service.listBuyers())[0]!;
  await service.saveBuyer({...buyer,firstName:'Nombre cambiado'});
  expect((await service.closing.view(id)).closure?.snapshot.sold[0]?.buyer.firstName).toBe('Ana');
  await service.closing.reopen(id,await revision()); expect((await service.operations.number(id,2)).status).toBe('disponible');
  await assign([2],'venta'); await close();
  expect((await service.closing.view(id)).closure?.id).not.toBe(view.closure?.id);
  expect((await db.read(tx => tx.query('SELECT * FROM closures;')))).toHaveLength(2);
});
it('cierre con revisión vieja o fallo de escritura no cancela parcialmente', async () => {
  const stale = await revision(); await assign([1,2],'reserva');
  await expect(service.closing.close(id,stale,true)).rejects.toThrow('cambió');
  await db.read(tx => tx.execute("CREATE TRIGGER fail_close BEFORE INSERT ON closures BEGIN SELECT RAISE(ABORT,'fallo inducido'); END;"));
  await expect(close()).rejects.toThrow('fallo inducido');
  expect((await service.operations.board(id)).reserved).toBe(2);
  expect((await service.getRaffle(id)).raffle.status).toBe('activo');
});
it('valida vendidos y premios, bloquea reapertura y registra correcciones con motivo', async () => {
  await assign([1,2,3],'venta'); await close(); const prizes = (await service.getRaffle(id)).prizes;
  await expect(service.closing.record(id,await revision(),prizes[0]!.id,9)).rejects.toThrow('participantes');
  await expect(service.closing.record(id,await revision(),prizes[0]!.id,20)).rejects.toThrow('rango');
  await service.closing.record(id,await revision(),prizes[0]!.id,1);
  await expect(service.closing.reopen(id,await revision())).rejects.toThrow('primera extracción');
  await expect(service.closing.record(id,await revision(),prizes[1]!.id,1)).rejects.toThrow('otro premio');
  await service.closing.record(id,await revision(),prizes[1]!.id,2);
  expect((await service.getRaffle(id)).raffle.status).toBe('sorteado');
  await expect(service.closing.record(id,await revision(),prizes[0]!.id,3)).rejects.toThrow('motivo');
  await service.closing.record(id,await revision(),prizes[0]!.id,3,'Error de transcripción');
  const view = await service.closing.view(id); expect(view.draws).toHaveLength(3); expect(view.results.find(r => r.prizeId === prizes[0]!.id)?.number).toBe(3);
  await service.closing.archive(id,await revision());
  await expect(service.closing.record(id,await revision(),prizes[0]!.id,1,'Cambio')).rejects.toThrow();
});
it('todos + vacante no otorga premio al reservante cancelado', async () => {
  await rule('vacant'); await assign([2],'reserva'); await close();
  const p = (await service.getRaffle(id)).prizes[0]!;
  expect(await service.closing.record(id,await revision(),p.id,2)).toBe('vacante');
  expect((await service.closing.view(id)).results[0]?.buyer).toBeNull();
});
it('todos + repetición registra extracción sin adjudicar y luego admite el vendido', async () => {
  await rule('repeat'); await assign([1],'venta'); await close();
  const p = (await service.getRaffle(id)).prizes[0]!;
  expect(await service.closing.record(id,await revision(),p.id,5)).toBe('repetir');
  expect((await service.closing.view(id)).results).toHaveLength(0);
  await expect(service.closing.reopen(id,await revision())).rejects.toThrow();
  expect(await service.closing.record(id,await revision(),p.id,1)).toBe('ganador');
});
it('fallo al registrar revierte extracción, resultado y bloqueo de reapertura', async () => {
  await assign([1],'venta'); await close();
  await db.read(tx => tx.execute("CREATE TRIGGER fail_result BEFORE INSERT ON results BEGIN SELECT RAISE(ABORT,'fallo resultado'); END;"));
  await expect(service.closing.record(id,await revision(),(await service.getRaffle(id)).prizes[0]!.id,1)).rejects.toThrow();
  expect((await service.closing.view(id)).hasDraws).toBe(false);
  await service.closing.reopen(id,await revision());
});
it('migra 4→5 sin reinterpretar reglas antiguas ni perder registros', async () => {
  const driver = new NodeDriver(); await migrate(driver,migrations.slice(0,4));
  await driver.run("INSERT INTO raffles(id,name,start_number,quantity,unit_price_cents,participants,unsold_rule,status,created_at,updated_at) VALUES('old','Antiguo',0,10,0,'todos','Regla escrita anterior','activo','hoy','hoy');");
  await migrate(driver); const old = new CatalogService(new Database(driver),'preview');
  await expect(old.closing.close('old',1,true)).rejects.toThrow('regla escrita anterior');
  expect((await driver.query("SELECT unsold_rule FROM raffles WHERE id='old';"))[0]?.unsold_rule).toBe('Regla escrita anterior'); await driver.close();
});
