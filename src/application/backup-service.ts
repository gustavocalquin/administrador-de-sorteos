import type { Database, SqlRow, SqlSession } from '../infrastructure/database/driver';
import { decryptBackup, digest, encryptBackup, MAX_PLAIN_BYTES } from '../infrastructure/backup/crypto';

// Dependency order is fixed by our schema, never by names or SQL from an import.
const tables = ['raffles','buyers','resources','prizes','operations','raffle_numbers','operation_items',
  'movements','movement_numbers','graphic_configurations','generated_sets','generated_images','closures','draws','results'] as const;
type Table = typeof tables[number];
interface Snapshot { format: 'sorteos-data'; schema: 7; createdAt: string; tables: Record<Table, SqlRow[]> }
export interface BackupPreview { token: string; createdAt: string; raffles: number; buyers: number; operations: number; resources: number; results: number }
const deleteTriggers = ['movements_no_delete','movement_numbers_no_delete','closures_no_delete','draws_no_delete'];
async function snapshot(tx: SqlSession): Promise<Snapshot> {
  const data = {} as Record<Table, SqlRow[]>;
  for (const table of tables) data[table] = await tx.query(`SELECT * FROM ${table} ORDER BY rowid;`);
  return { format: 'sorteos-data', schema: 7, createdAt: new Date().toISOString(), tables: data };
}
function fingerprint(value: Snapshot) { return digest(JSON.stringify(value.tables)); }
function parse(text: string): Snapshot {
  if (new TextEncoder().encode(text).length > MAX_PLAIN_BYTES) throw new Error('El respaldo excede 128 MB.');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Contenido del respaldo inválido.'); }
  if (!value || value.format !== 'sorteos-data' || ![5, 6, 7].includes(value.schema) || typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) || !value.tables || Object.keys(value.tables).length !== tables.length)
    throw new Error('Versión o contenido del respaldo no compatible. Se requiere esquema 5, 6 o 7.');
  let count = 0;
  for (const table of tables) {
    if (!Array.isArray(value.tables[table])) throw new Error('Falta una tabla del respaldo.');
    count += value.tables[table].length;
    for (const row of value.tables[table]) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.values(row).some(v =>
        v !== null && typeof v !== 'string' && !(typeof v === 'number' && Number.isSafeInteger(v)))) throw new Error('Fila inválida en el respaldo.');
    }
  }
  if (count > 1_000_000) throw new Error('El respaldo excede el límite de filas.');
  if (value.schema === 5) {
    value.tables.prizes = value.tables.prizes.map((row: SqlRow) => ({ ...row, image_resource_id: null }));
  }
  value.schema = 7;
  return value as Snapshot;
}
async function replace(tx: SqlSession, value: Snapshot): Promise<void> {
  const columns = new Map<Table,string[]>();
  for (const table of tables) {
    const names = (await tx.query(`PRAGMA table_info(${table});`)).map(c => String(c.name)); columns.set(table,names);
    for (const row of value.tables[table]) if (Object.keys(row).length !== names.length || names.some(n => !Object.hasOwn(row,n)))
      throw new Error(`Estructura incompatible en ${table}.`);
  }
  const triggers: string[] = [];
  for (const name of deleteTriggers) {
    const sql = (await tx.query("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?;",[name]))[0]?.sql;
    if (typeof sql !== 'string') throw new Error('Falta una protección de historial en la base actual.');
    triggers.push(sql); await tx.execute(`DROP TRIGGER ${name};`);
  }
  for (const table of [...tables].reverse()) await tx.execute(`DELETE FROM ${table};`);
  for (const table of tables) {
    const names = columns.get(table)!;
    const statement = `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')});`;
    for (const row of value.tables[table]) await tx.run(statement,names.map(n => row[n]!));
  }
  for (const sql of triggers) await tx.execute(sql);
  if ((await tx.query('PRAGMA foreign_key_check;')).length || (await tx.query('PRAGMA quick_check;')).some(r => Object.values(r)[0] !== 'ok'))
    throw new Error('El respaldo no supera la verificación de integridad.');
  const broken = await tx.query(`SELECT n.id FROM raffle_numbers n LEFT JOIN operation_items i
    ON i.number_id=n.id AND i.operation_id=n.active_operation_id WHERE n.status<>'disponible'
    AND (i.status IS NULL OR i.status<>CASE n.status WHEN 'vendido' THEN 'pagado' ELSE 'reservado' END) LIMIT 1;`);
  if (broken.length) throw new Error('Hay asignaciones inconsistentes en el respaldo.');
  for (const c of value.tables.closures) {
    let s; try { s = JSON.parse(String(c.snapshot_json)); } catch { throw new Error('Instantánea de cierre inválida.'); }
    if (!s || !Number.isSafeInteger(s.start) || !Number.isSafeInteger(s.quantity) || s.quantity <= 0 || !Number.isSafeInteger(s.start + (s.quantity - 1)) ||
      !['todos','solo_vendidos'].includes(s.participants) || !Array.isArray(s.sold) || typeof s.method !== 'string') throw new Error('Instantánea de cierre inválida.');
    const seen = new Set<number>();
    for (const n of s.sold) {
      if (!n || !Number.isSafeInteger(n.value) || n.value < s.start || n.value > s.start + (s.quantity - 1) || seen.has(n.value) ||
        !n.buyer || ['id','firstName','lastName','phone'].some(k => typeof n.buyer[k] !== 'string')) throw new Error('Participantes del cierre inválidos.');
      seen.add(n.value);
    }
  }
  for (const result of value.tables.results) {
    const closure = value.tables.closures.find(c => c.id === result.closure_id && c.raffle_id === result.raffle_id);
    const prize = value.tables.prizes.find(p => p.id === result.prize_id && p.raffle_id === result.raffle_id);
    if (!closure || !prize) throw new Error('Resultado inconsistente.');
    const s = JSON.parse(String(closure.snapshot_json));
    const winner = s.sold.find((n: { value: number }) => n.value === result.number)?.buyer ?? null;
    if (!Number.isSafeInteger(result.number) || Number(result.number) < s.start || Number(result.number) > s.start + (s.quantity - 1) ||
      (s.participants === 'solo_vendidos' && !winner) || JSON.stringify(winner) !== (result.buyer_json ?? 'null')) throw new Error('Ganador inconsistente.');
  }
}

export class BackupService {
  private pending: { token: string; value: Snapshot; current: string } | null = null;
  constructor(private readonly db: Database) {}
  async create(password: string): Promise<{ file: string; fingerprint: string }> {
    const value = await this.db.read(snapshot);
    return { file: await encryptBackup(JSON.stringify(value),password), fingerprint: await fingerprint(value) };
  }
  async markExported(hash: string): Promise<void> {
    await this.db.transaction(tx => tx.run('UPDATE backup_state SET exported_at=?,exported_fingerprint=? WHERE id=1;', [new Date().toISOString(),hash]));
  }
  async status(): Promise<{ exportedAt: string | null; reminder: boolean; recoveryAt: string | null }> {
    return this.db.read(async tx => {
      const state = (await tx.query('SELECT * FROM backup_state WHERE id=1;'))[0]!;
      const recovery = (await tx.query('SELECT created_at FROM backup_recovery WHERE id=1;'))[0];
      const first = (await tx.query('SELECT created_at FROM movements ORDER BY rowid LIMIT 1;'))[0]?.created_at;
      const since = state.exported_at ?? first;
      const weekPassed = since !== null && since !== undefined && Date.now() - Date.parse(String(since)) >= 7 * 86400000;
      return { exportedAt: state.exported_at === null ? null : String(state.exported_at), recoveryAt: recovery ? String(recovery.created_at) : null,
        reminder: weekPassed && state.exported_fingerprint !== await fingerprint(await snapshot(tx)) };
    });
  }
  async preview(file: string, password: string): Promise<BackupPreview> {
    this.pending = null;
    return this.prepare(parse(await decryptBackup(file,password)));
  }
  async previewRecovery(): Promise<BackupPreview> {
    this.pending = null;
    const row = await this.db.read(async tx => (await tx.query('SELECT payload FROM backup_recovery WHERE id=1;'))[0]);
    if (!row) throw new Error('No hay un resguardo interno previo.');
    return this.prepare(parse(String(row.payload)));
  }
  private async prepare(value: Snapshot): Promise<BackupPreview> {
    let current = '';
    // Validate against the real SQLite schema, then force rollback even on success.
    // No imported changes become visible to another operation through Database's queue.
    const validated = new Error('rollback-validation');
    try {
      await this.db.transaction(async tx => { current = await fingerprint(await snapshot(tx)); await replace(tx,value); throw validated; });
    } catch (e) { if (e !== validated) throw e; }
    const token = crypto.randomUUID(); this.pending = { token,value,current };
    return { token,createdAt: value.createdAt,raffles: value.tables.raffles.length,buyers: value.tables.buyers.length,
      operations: value.tables.operations.length,resources: value.tables.resources.length,results: value.tables.results.length };
  }
  discardPreview() { this.pending = null; }
  async restore(token: string, confirmation: string): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.token !== token || confirmation !== 'REEMPLAZAR') throw new Error('Revisá la vista previa y escribí REEMPLAZAR para confirmar.');
    await this.db.transaction(async tx => {
      const previous = await snapshot(tx);
      if (await fingerprint(previous) !== pending.current) throw new Error('Tus datos cambiaron desde la vista previa. Volvé a revisar el respaldo.');
      const payload = JSON.stringify(previous);
      if (new TextEncoder().encode(payload).length > MAX_PLAIN_BYTES) throw new Error('No se puede crear el resguardo previo: excede 128 MB. No se reemplazaron datos.');
      await tx.run(`INSERT INTO backup_recovery(id,created_at,payload) VALUES(1,?,?)
        ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,payload=excluded.payload;`,[new Date().toISOString(),payload]);
      await replace(tx,pending.value);
      await tx.run('UPDATE backup_state SET exported_at=NULL,exported_fingerprint=NULL WHERE id=1;');
    });
    this.pending = null;
  }
}
