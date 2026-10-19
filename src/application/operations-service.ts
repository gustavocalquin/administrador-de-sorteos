import { normalizePhone, validateBuyer } from '../domain/catalog';
import { PAGE_SIZE, validateSelection, type Board, type BuyerChoice, type HistoryEntry, type NumberToken, type NumberView } from '../domain/operations';
import type { Raffle } from '../domain/models';
import { Database, type SqlRow, type SqlSession } from '../infrastructure/database/driver';
import { mapRaffle } from '../infrastructure/database/repositories/raffles';

const numberQuery = `SELECT n.*, b.first_name, b.last_name, b.phone, i.unit_price_cents, o.created_at AS assigned_at
  FROM raffle_numbers n LEFT JOIN buyers b ON b.id=n.buyer_id
  LEFT JOIN operations o ON o.id=n.active_operation_id
  LEFT JOIN operation_items i ON i.operation_id=n.active_operation_id AND i.number_id=n.id`;
function mapNumber(row: SqlRow, price: number): NumberView {
  return { id: String(row.id), value: Number(row.value), revision: Number(row.revision), status: row.status as NumberView['status'],
    buyerId: row.buyer_id === null ? null : String(row.buyer_id), buyerName: row.buyer_id === null ? null : `${row.first_name} ${row.last_name}`,
    phone: row.phone === null ? null : String(row.phone), operationId: row.active_operation_id === null ? null : String(row.active_operation_id),
    unitPriceCents: row.unit_price_cents === null ? row.status === 'disponible' ? price : NaN : Number(row.unit_price_cents), assignedAt: row.assigned_at === null ? null : String(row.assigned_at) };
}
async function getRaffle(tx: SqlSession, id: string) {
  const row = (await tx.query('SELECT * FROM raffles WHERE id=?;', [id]))[0];
  if (!row) throw new Error('No se encontró el sorteo.');
  return { raffle: mapRaffle(row), revision: Number(row.revision) };
}
async function getNumber(tx: SqlSession, raffle: Raffle, value: number): Promise<NumberView> {
  const row = (await tx.query(`${numberQuery} WHERE n.raffle_id=? AND n.value=?;`, [raffle.id, value]))[0];
  return row ? mapNumber(row, raffle.unitPriceCents) : { id: null, value, revision: 0, status: 'disponible', buyerId: null,
    buyerName: null, phone: null, operationId: null, unitPriceCents: raffle.unitPriceCents, assignedAt: null };
}
async function checked(tx: SqlSession, raffle: Raffle, tokens: NumberToken[], state?: NumberView['status']): Promise<NumberView[]> {
  validateSelection(tokens, raffle);
  const result: NumberView[] = [];
  for (const token of tokens) {
    const n = await getNumber(tx, raffle, token.value);
    if (n.revision !== token.revision || (state && n.status !== state))
      throw new Error(`El número ${n.value} cambió. Actualizá la grilla y revisá la selección.`);
    if (n.status !== 'disponible' && (!n.operationId || !n.buyerId || !n.id || !Number.isSafeInteger(n.unitPriceCents)))
      throw new Error('La asignación está incompleta. Conservá los datos para revisarlos.');
    if (n.status !== 'disponible') {
      const item = (await tx.query('SELECT status FROM operation_items WHERE operation_id=? AND number_id=?;', [n.operationId, n.id]))[0];
      if (item?.status !== (n.status === 'vendido' ? 'pagado' : 'reservado')) throw new Error('La asignación no coincide con su operación. Conservá los datos para revisarlos.');
    }
    result.push(n);
  }
  return result;
}
function allowExisting(raffle: Raffle) {
  if (!['activo', 'pausado'].includes(raffle.status)) throw new Error('Este sorteo no admite operaciones.');
}
async function resolveBuyer(tx: SqlSession, choice: BuyerChoice): Promise<string> {
  if (choice.kind === 'existing') {
    if (!(await tx.query('SELECT id FROM buyers WHERE id=?;', [choice.id])).length) throw new Error('El comprador ya no está disponible.');
    return choice.id;
  }
  const b = validateBuyer(choice.input); const id = crypto.randomUUID(); const now = new Date().toISOString();
  await tx.run(`INSERT INTO buyers (id,phone,phone_key,first_name,last_name,email,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?);`,
    [id, b.phone, normalizePhone(b.phone), b.firstName, b.lastName, b.email, b.notes, now, now]);
  await tx.run('INSERT INTO movements (id,entity_type,entity_id,action,after_json,created_at) VALUES (?,?,?,?,?,?);',
    [crypto.randomUUID(), 'comprador', id, 'crear', JSON.stringify(b), now]);
  return id;
}
async function insertOperation(tx: SqlSession, raffleId: string, buyerId: string, type: 'venta' | 'reserva'): Promise<string> {
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await tx.run('INSERT INTO operations (id,raffle_id,buyer_id,type,status,amount_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?);',
    [id, raffleId, buyerId, type, type === 'venta' ? 'completada' : 'vigente', 0, now, now]);
  return id;
}
export async function reconcile(tx: SqlSession, id: string): Promise<void> {
  const items = await tx.query('SELECT status,unit_price_cents FROM operation_items WHERE operation_id=?;', [id]);
  const paid = items.filter(i => i.status === 'pagado'); const reserved = items.filter(i => i.status === 'reservado');
  const active = paid.length + reserved.length;
  const status = active === 0 ? 'anulada' : paid.length === items.length ? 'completada' : reserved.length === items.length ? 'vigente' : 'parcial';
  const amount = paid.reduce((sum, i) => sum + Number(i.unit_price_cents), 0);
  if (!Number.isSafeInteger(amount)) throw new Error('El importe excede el límite permitido.');
  await tx.run('UPDATE operations SET status=?,amount_cents=?,updated_at=? WHERE id=?;', [status, amount, new Date().toISOString(), id]);
}
async function record(tx: SqlSession, raffle: Raffle, action: string, before: NumberView[], reason: string | null) {
  const after: NumberView[] = [];
  for (const n of before) after.push(await getNumber(tx, raffle, n.value));
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  await tx.run(`INSERT INTO movements (id,entity_type,entity_id,action,before_json,after_json,reason,created_at) VALUES (?,?,?,?,?,?,?,?);`,
    [id, 'sorteo', raffle.id, action, JSON.stringify(before), JSON.stringify(after), reason, now]);
  for (const n of before) await tx.run('INSERT INTO movement_numbers (movement_id,raffle_id,value) VALUES (?,?,?);', [id, raffle.id, n.value]);
  await tx.run('UPDATE raffles SET revision=revision+1,updated_at=? WHERE id=?;', [now, raffle.id]);
  await tx.run('UPDATE graphic_configurations SET dirty=1,generated_at=NULL WHERE raffle_id=?;', [raffle.id]);
}

export class OperationsService {
  constructor(private readonly db: Database) {}
  board(id: string, offset = 0): Promise<Board> {
    return this.db.read(async tx => {
      const { raffle, revision } = await getRaffle(tx, id);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= raffle.quantity) throw new Error('Página fuera del rango.');
      const start = raffle.startNumber + offset; const count = Math.min(PAGE_SIZE, raffle.quantity - offset);
      const rows = await tx.query(`${numberQuery} WHERE n.raffle_id=? AND n.value BETWEEN ? AND ? ORDER BY n.value;`, [id, start, start + (count - 1)]);
      const stored = new Map(rows.map(row => [Number(row.value), mapNumber(row, raffle.unitPriceCents)]));
      const numbers = Array.from({ length: count }, (_, i) => stored.get(start + i) ?? { id: null, value: start + i,
        revision: 0, status: 'disponible' as const, buyerId: null, buyerName: null, phone: null, operationId: null,
        unitPriceCents: raffle.unitPriceCents, assignedAt: null });
      const stats = await tx.query(`SELECT n.status,COUNT(*) AS count,COALESCE(SUM(i.unit_price_cents),0) AS amount
        FROM raffle_numbers n LEFT JOIN operation_items i ON i.operation_id=n.active_operation_id AND i.number_id=n.id
        WHERE n.raffle_id=? AND n.status<>'disponible' GROUP BY n.status;`, [id]);
      const sold = Number(stats.find(s => s.status === 'vendido')?.count ?? 0);
      const reserved = Number(stats.find(s => s.status === 'reservado')?.count ?? 0);
      const dirty = (await tx.query('SELECT dirty FROM graphic_configurations WHERE raffle_id=?;', [id]))[0]?.dirty;
      return { raffle, revision, offset, numbers, sold, reserved, available: raffle.quantity - sold - reserved,
        collectedCents: Number(stats.find(s => s.status === 'vendido')?.amount ?? 0), imageDirty: dirty !== 0 };
    });
  }
  number(id: string, value: number): Promise<NumberView> {
    return this.db.read(async tx => { const { raffle } = await getRaffle(tx, id); validateSelection([{ value, revision: 0 }], raffle); return getNumber(tx, raffle, value); });
  }
  reservations(id: string, offset = 0): Promise<NumberView[]> {
    return this.db.read(async tx => {
      const { raffle } = await getRaffle(tx, id);
      return (await tx.query(`${numberQuery} WHERE n.raffle_id=? AND n.status='reservado' ORDER BY n.value LIMIT ? OFFSET ?;`, [id, PAGE_SIZE, offset])).map(r => mapNumber(r, raffle.unitPriceCents));
    });
  }
  reservationGroup(id: string, operationId: string): Promise<NumberView[]> {
    return this.db.read(async tx => {
      const { raffle } = await getRaffle(tx, id);
      return (await tx.query(`${numberQuery} WHERE n.raffle_id=? AND n.active_operation_id=? AND n.status='reservado' ORDER BY n.value;`, [id, operationId])).map(r => mapNumber(r, raffle.unitPriceCents));
    });
  }
  history(id: string, value?: number, beforeSequence = Number.MAX_SAFE_INTEGER): Promise<HistoryEntry[]> {
    return this.db.read(async tx => (await tx.query(`SELECT m.*,m.rowid AS sequence FROM movements m WHERE m.entity_type='sorteo'
      AND m.entity_id=? AND m.rowid<? ${value === undefined ? '' : 'AND EXISTS (SELECT 1 FROM movement_numbers mn WHERE mn.movement_id=m.id AND mn.raffle_id=? AND mn.value=?)'}
      ORDER BY m.rowid DESC LIMIT 30;`, value === undefined ? [id, beforeSequence] : [id, beforeSequence, id, value])).map(row => ({
        id: String(row.id), sequence: Number(row.sequence), action: String(row.action), beforeJson: row.before_json === null ? null : String(row.before_json),
        afterJson: row.after_json === null ? null : String(row.after_json), reason: row.reason === null ? null : String(row.reason), createdAt: String(row.created_at) })));
  }
  assign(id: string, raffleRevision: number, selection: NumberToken[], buyer: BuyerChoice, type: 'reserva' | 'venta'): Promise<void> {
    return this.db.transaction(async tx => {
      const { raffle, revision } = await getRaffle(tx, id);
      if (raffle.status !== 'activo') throw new Error('Activá o reanudá el sorteo para reservar o vender.');
      if (revision !== raffleRevision) throw new Error('El sorteo cambió. Actualizá la grilla antes de confirmar.');
      const before = await checked(tx, raffle, selection, 'disponible');
      const buyerId = await resolveBuyer(tx, buyer); const operationId = await insertOperation(tx, id, buyerId, type);
      for (const n of before) {
        const numberId = n.id ?? crypto.randomUUID();
        if (!n.id) await tx.run("INSERT INTO raffle_numbers (id,raffle_id,value,status) VALUES (?,?,?,'disponible');", [numberId, id, n.value]);
        await tx.run('INSERT INTO operation_items (operation_id,number_id,raffle_id,unit_price_cents,status) VALUES (?,?,?,?,?);',
          [operationId, numberId, id, raffle.unitPriceCents, type === 'venta' ? 'pagado' : 'reservado']);
        await tx.run('UPDATE raffle_numbers SET status=?,buyer_id=?,active_operation_id=?,revision=revision+1 WHERE id=?;',
          [type === 'venta' ? 'vendido' : 'reservado', buyerId, operationId, numberId]);
      }
      await reconcile(tx, operationId); await record(tx, raffle, type === 'venta' ? 'venta' : 'reserva', before, null);
    });
  }
  pay(id: string, selection: NumberToken[]): Promise<void> {
    return this.db.transaction(async tx => {
      const { raffle } = await getRaffle(tx, id); allowExisting(raffle);
      const before = await checked(tx, raffle, selection, 'reservado');
      for (const n of before) {
        await tx.run("UPDATE operation_items SET status='pagado' WHERE operation_id=? AND number_id=? AND status='reservado';", [n.operationId, n.id]);
        await tx.run("UPDATE raffle_numbers SET status='vendido',revision=revision+1 WHERE id=?;", [n.id]);
      }
      for (const op of new Set(before.map(n => n.operationId!))) await reconcile(tx, op);
      await record(tx, raffle, 'confirmar_pago', before, null);
    });
  }
  clear(id: string, selection: NumberToken[], reason: string, acknowledgeRefund = false): Promise<void> {
    return this.db.transaction(async tx => {
      const { raffle } = await getRaffle(tx, id); allowExisting(raffle);
      const before = await checked(tx, raffle, selection);
      if (before.some(n => n.status === 'disponible')) throw new Error('Solo se pueden limpiar números asignados.');
      if (!reason.trim()) throw new Error('Indicá el motivo para conservarlo en el historial.');
      if (before.some(n => n.status === 'vendido') && !acknowledgeRefund) throw new Error('Confirmá que revisaste la posible devolución de dinero.');
      for (const n of before) {
        await tx.run("UPDATE operation_items SET status='cancelado' WHERE operation_id=? AND number_id=?;", [n.operationId, n.id]);
        await tx.run("UPDATE raffle_numbers SET status='disponible',buyer_id=NULL,active_operation_id=NULL,revision=revision+1 WHERE id=?;", [n.id]);
      }
      for (const op of new Set(before.map(n => n.operationId!))) await reconcile(tx, op);
      await record(tx, raffle, 'limpiar', before, reason.trim());
    });
  }
  correctBuyer(id: string, token: NumberToken, buyer: BuyerChoice, reason: string): Promise<void> {
    return this.db.transaction(async tx => {
      const { raffle } = await getRaffle(tx, id); allowExisting(raffle);
      const before = await checked(tx, raffle, [token]); const n = before[0]!;
      if (n.status === 'disponible') throw new Error('El número no tiene una asignación para corregir.');
      if (!reason.trim()) throw new Error('Indicá el motivo de la corrección.');
      const buyerId = await resolveBuyer(tx, buyer);
      if (buyerId === n.buyerId) throw new Error('Elegí un comprador diferente. Los datos de su ficha se editan en Compradores.');
      const operationId = await insertOperation(tx, id, buyerId, n.status === 'vendido' ? 'venta' : 'reserva');
      await tx.run('INSERT INTO operation_items (operation_id,number_id,raffle_id,unit_price_cents,status) VALUES (?,?,?,?,?);',
        [operationId, n.id, id, n.unitPriceCents, n.status === 'vendido' ? 'pagado' : 'reservado']);
      await tx.run("UPDATE operation_items SET status='cancelado' WHERE operation_id=? AND number_id=?;", [n.operationId, n.id]);
      await tx.run('UPDATE raffle_numbers SET buyer_id=?,active_operation_id=?,revision=revision+1 WHERE id=?;', [buyerId, operationId, n.id]);
      await reconcile(tx, n.operationId!); await reconcile(tx, operationId);
      await record(tx, raffle, 'corregir_comprador', before, reason.trim());
    });
  }
}
