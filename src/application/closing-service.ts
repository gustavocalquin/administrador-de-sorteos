import { unsoldPolicy, type Closure, type ClosureSnapshot, type ClosingView } from '../domain/closing';
import type { Database, SqlSession } from '../infrastructure/database/driver';
import { mapRaffle } from '../infrastructure/database/repositories/raffles';
import { reconcile } from './operations-service';

async function checked(tx: SqlSession, id: string, revision: number) {
  const row = (await tx.query('SELECT * FROM raffles WHERE id=?;', [id]))[0];
  if (!row || Number(row.revision) !== revision) throw new Error('El sorteo cambió. Actualizá los datos antes de confirmar.');
  return mapRaffle(row);
}
async function latest(tx: SqlSession, id: string): Promise<Closure | null> {
  const row = (await tx.query('SELECT * FROM closures WHERE raffle_id=? ORDER BY rowid DESC LIMIT 1;', [id]))[0];
  return row ? { id: String(row.id), closedAt: String(row.closed_at), snapshot: JSON.parse(String(row.snapshot_json)) as ClosureSnapshot } : null;
}
async function audit(tx: SqlSession, id: string, action: string, before: unknown, after: unknown, reason: string | null = null, numbers: number[] = []) {
  const movement = crypto.randomUUID(); const now = new Date().toISOString();
  await tx.run('INSERT INTO movements(id,entity_type,entity_id,action,before_json,after_json,reason,created_at) VALUES(?,?,?,?,?,?,?,?);',
    [movement, 'sorteo', id, action, JSON.stringify(before), JSON.stringify(after), reason, now]);
  for (const number of new Set(numbers)) await tx.run('INSERT INTO movement_numbers(movement_id,raffle_id,value) VALUES(?,?,?);', [movement,id,number]);
  await tx.run('UPDATE raffles SET revision=revision+1,updated_at=? WHERE id=?;', [now,id]);
  await tx.run('UPDATE graphic_configurations SET dirty=1,generated_at=NULL WHERE raffle_id=?;', [id]);
}
export class ClosingService {
  constructor(private readonly db: Database) {}
  view(id: string): Promise<ClosingView> {
    return this.db.read(async tx => ({ closure: await latest(tx,id),
      results: (await tx.query('SELECT * FROM results WHERE raffle_id=?;', [id])).map(r => ({ prizeId: String(r.prize_id), number: Number(r.number),
        buyer: r.buyer_json === null ? null : JSON.parse(String(r.buyer_json)), recordedAt: String(r.recorded_at) })),
      hasDraws: (await tx.query('SELECT id FROM draws WHERE raffle_id=? LIMIT 1;', [id])).length > 0,
      draws: (await tx.query('SELECT * FROM draws WHERE raffle_id=? ORDER BY rowid DESC;', [id])).map(r => ({ prizeId: String(r.prize_id), number: Number(r.number), outcome: String(r.outcome), reason: r.reason === null ? null : String(r.reason), recordedAt: String(r.recorded_at) })) }));
  }
  close(id: string, revision: number, confirmed: boolean): Promise<void> {
    return this.db.transaction(async tx => {
      const raffle = await checked(tx,id,revision);
      if (!confirmed) throw new Error('Confirmá la cancelación de todas las reservas impagas.');
      if (!['activo','pausado'].includes(raffle.status)) throw new Error('Solo se pueden cerrar ventas activas o pausadas.');
      if (raffle.participants === 'todos' && !unsoldPolicy(raffle.unsoldRule))
        throw new Error('Este sorteo conserva una regla escrita anterior. No se reinterpretará automáticamente: revisá sus condiciones antes de cerrar.');
      const reserved = await tx.query("SELECT * FROM raffle_numbers WHERE raffle_id=? AND status='reservado';", [id]);
      for (const n of reserved) {
        const item = (await tx.query('SELECT status FROM operation_items WHERE operation_id=? AND number_id=?;', [n.active_operation_id!, n.id!]))[0];
        if (item?.status !== 'reservado') throw new Error('Una reserva no coincide con su operación. El cierre no se realizó.');
        await tx.run("UPDATE operation_items SET status='cancelado' WHERE operation_id=? AND number_id=?;", [n.active_operation_id!,n.id!]);
        await tx.run("UPDATE raffle_numbers SET status='disponible',buyer_id=NULL,active_operation_id=NULL,revision=revision+1 WHERE id=?;", [n.id!]);
      }
      for (const operation of new Set(reserved.map(n => String(n.active_operation_id)))) await reconcile(tx,operation);
      const sold = await tx.query(`SELECT n.value,b.* FROM raffle_numbers n JOIN buyers b ON b.id=n.buyer_id WHERE n.raffle_id=? AND n.status='vendido' ORDER BY n.value;`, [id]);
      const snapshot: ClosureSnapshot = { start: raffle.startNumber, quantity: raffle.quantity, participants: raffle.participants,
        method: raffle.drawMethod, unsoldRule: raffle.unsoldRule,
        sold: sold.map(r => ({ value: Number(r.value), buyer: { id: String(r.id), firstName: String(r.first_name), lastName: String(r.last_name), phone: String(r.phone) } })) };
      const closureId = crypto.randomUUID();
      await tx.run('INSERT INTO closures(id,raffle_id,closed_at,snapshot_json) VALUES(?,?,?,?);', [closureId,id,new Date().toISOString(),JSON.stringify(snapshot)]);
      await tx.run("UPDATE raffles SET status='ventas_cerradas' WHERE id=?;", [id]);
      await audit(tx,id,'cerrar_ventas',reserved,{ closureId, cancelled: reserved.length, sold: sold.length },null,reserved.map(n => Number(n.value)));
    });
  }
  reopen(id: string, revision: number): Promise<void> {
    return this.db.transaction(async tx => {
      const raffle = await checked(tx,id,revision);
      if (raffle.status !== 'ventas_cerradas' || (await tx.query('SELECT id FROM draws WHERE raffle_id=? LIMIT 1;', [id])).length)
        throw new Error('Solo se puede reabrir antes de registrar la primera extracción.');
      const closure = await latest(tx,id);
      await tx.run("UPDATE raffles SET status='activo' WHERE id=?;", [id]);
      await audit(tx,id,'reabrir_ventas',{ closureId: closure?.id },{ reservationsRestored: false });
    });
  }
  record(id: string, revision: number, prizeId: string, number: number, reason = ''): Promise<'repetir' | 'ganador' | 'vacante'> {
    return this.db.transaction(async tx => {
      const raffle = await checked(tx,id,revision);
      if (!['ventas_cerradas','sorteado'].includes(raffle.status)) throw new Error('Cerrá las ventas antes de registrar resultados.');
      const closure = await latest(tx,id);
      if (!closure) throw new Error('No existe una instantánea de cierre.');
      const s = closure.snapshot;
      if (!Number.isSafeInteger(number) || number < s.start || number > s.start + (s.quantity - 1)) throw new Error('Número fuera del rango del cierre.');
      if (!(await tx.query('SELECT id FROM prizes WHERE id=? AND raffle_id=?;', [prizeId,id])).length) throw new Error('Premio inválido.');
      const before = (await tx.query('SELECT * FROM results WHERE prize_id=?;', [prizeId]))[0] ?? null;
      if (before && !reason.trim()) throw new Error('La corrección requiere un motivo.');
      if (before && Number(before.number) === number) throw new Error('Ingresá un número diferente para corregir.');
      if ((await tx.query('SELECT prize_id FROM results WHERE raffle_id=? AND number=? AND prize_id<>?;', [id,number,prizeId])).length)
        throw new Error('Ese número ya corresponde a otro premio.');
      const winner = s.sold.find(n => n.value === number)?.buyer ?? null;
      if (!winner && s.participants === 'solo_vendidos') throw new Error('Ese número no pertenece a los participantes vendidos del cierre.');
      const policy = unsoldPolicy(s.unsoldRule);
      if (!winner && !policy) throw new Error('La regla del cierre no permite resolver este número.');
      const outcome = winner ? 'ganador' : policy === 'repeat' ? 'repetir' : 'vacante';
      if (before && outcome === 'repetir') throw new Error('Para corregir este premio registrá el nuevo número vendido; el resultado anterior se conserva.');
      const now = new Date().toISOString();
      await tx.run('INSERT INTO draws(id,raffle_id,closure_id,prize_id,number,outcome,reason,recorded_at) VALUES(?,?,?,?,?,?,?,?);',
        [crypto.randomUUID(),id,closure.id,prizeId,number,before ? 'correccion' : outcome,reason.trim() || null,now]);
      if (outcome !== 'repetir') await tx.run(`INSERT INTO results(prize_id,raffle_id,closure_id,number,buyer_json,recorded_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(prize_id) DO UPDATE SET number=excluded.number,buyer_json=excluded.buyer_json,recorded_at=excluded.recorded_at;`,
      [prizeId,id,closure.id,number,winner ? JSON.stringify(winner) : null,now]);
      const remaining = await tx.query('SELECT id FROM prizes WHERE raffle_id=? AND id NOT IN (SELECT prize_id FROM results WHERE raffle_id=?);',[id,id]);
      if (!remaining.length) await tx.run("UPDATE raffles SET status='sorteado' WHERE id=?;",[id]);
      await audit(tx,id,before ? 'corregir_resultado' : 'registrar_extraccion',before,{ prizeId,number,outcome,winner,method: s.method },reason.trim() || null,
        before ? [Number(before.number),number] : [number]);
      return outcome;
    });
  }
  archive(id: string, revision: number): Promise<void> {
    return this.db.transaction(async tx => {
      const raffle = await checked(tx,id,revision);
      if (raffle.status !== 'sorteado') throw new Error('Completá todos los premios antes de archivar.');
      await tx.run("UPDATE raffles SET status='archivado' WHERE id=?;",[id]);
      await audit(tx,id,'archivar',raffle.status,'archivado');
    });
  }
}
