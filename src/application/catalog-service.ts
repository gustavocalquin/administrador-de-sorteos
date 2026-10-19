import { normalizePhone, searchBuyers, validateBuyer, validateDetails, type BuyerInput, type BuyerRecord, type Palette, type RaffleDetails, type Template } from '../domain/catalog';
import type { Raffle } from '../domain/models';
import { Database, type SqlSession } from '../infrastructure/database/driver';
import { insertRaffle, mapRaffle, SqliteRaffleRepository } from '../infrastructure/database/repositories/raffles';
import { OperationsService } from './operations-service';
import { GraphicsService } from './graphics-service';
import { ClosingService } from './closing-service';
import { BackupService } from './backup-service';
import { unsoldPolicy } from '../domain/closing';

async function details(tx: SqlSession, id: string): Promise<RaffleDetails> {
  const row = (await tx.query('SELECT * FROM raffles WHERE id = ?;', [id]))[0];
  if (!row) throw new Error('No se encontró el sorteo.');
  const config = (await tx.query(`SELECT g.*, r.data_url FROM graphic_configurations g
    LEFT JOIN resources r ON r.id = g.original_resource_id WHERE g.raffle_id = ?;`, [id]))[0];
  const operations = await tx.query(`SELECT id FROM operations WHERE raffle_id = ? LIMIT 1;`, [id]);
  const assigned = await tx.query(`SELECT id FROM raffle_numbers WHERE raffle_id = ? AND status <> 'disponible' LIMIT 1;`, [id]);
  return { raffle: mapRaffle(row), revision: Number(row.revision), locked: operations.length > 0 || assigned.length > 0,
    prizes: (await tx.query(`SELECT p.*, r.data_url FROM prizes p LEFT JOIN resources r ON r.id=p.image_resource_id
      WHERE p.raffle_id = ? ORDER BY p.position;`, [id])).map(p => ({
      id: String(p.id), raffleId: id, position: Number(p.position), description: String(p.description), image: p.data_url ? String(p.data_url) : null })),
    template: (config?.template ?? 'clasica') as Template, palette: (config?.palette ?? 'bosque') as Palette,
    image: config?.data_url ? String(config.data_url) : null };
}

async function audit(tx: SqlSession, entity: string, id: string, action: string, before: unknown, after: unknown): Promise<void> {
  await tx.run(`INSERT INTO movements (id, entity_type, entity_id, action, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?);`, [crypto.randomUUID(), entity, id, action, before === null ? null : JSON.stringify(before),
    JSON.stringify(after), new Date().toISOString()]);
}

function conditions(value: RaffleDetails): string {
  const r = value.raffle;
  return JSON.stringify([r.name, r.description, r.startNumber, r.quantity, r.unitPriceCents, r.drawAt, r.drawMethod,
    r.participants, r.unsoldRule, value.prizes.map(p => [p.id, p.description])]);
}
function withoutImage(value: RaffleDetails): object {
  const { image, ...rest } = value;
  return { ...rest, prizes: value.prizes.map(({ image: prizeImage, ...prize }) => ({ ...prize, hasImage: prizeImage != null })), hasImage: image !== null };
}

export class CatalogService {
  readonly operations: OperationsService;
  readonly graphics: GraphicsService;
  readonly closing: ClosingService;
  readonly backups: BackupService;
  constructor(private readonly db: Database, readonly storage: 'android' | 'preview') {
    this.operations = new OperationsService(db); this.graphics = new GraphicsService(db, details);
    this.closing = new ClosingService(db); this.backups = new BackupService(db);
  }
  listRaffles(): Promise<Raffle[]> { return new SqliteRaffleRepository(this.db).list(); }
  getRaffle(id: string): Promise<RaffleDetails> { return this.db.read(tx => details(tx, id)); }

  async deleteRaffle(id: string): Promise<void> {
    return this.db.transaction(async tx => {
      if (!(await tx.query('SELECT id FROM raffles WHERE id=?;', [id])).length) throw new Error('El sorteo ya no existe.');
      const resourceIds = new Set<string>();
      const config = (await tx.query('SELECT original_resource_id FROM graphic_configurations WHERE raffle_id=?;', [id]))[0];
      if (typeof config?.original_resource_id === 'string') resourceIds.add(config.original_resource_id);
      for (const prize of await tx.query('SELECT image_resource_id FROM prizes WHERE raffle_id=?;', [id]))
        if (typeof prize.image_resource_id === 'string') resourceIds.add(prize.image_resource_id);
      const movementRows = await tx.query("SELECT before_json,after_json FROM movements WHERE entity_type='sorteo' AND entity_id=?;", [id]);
      for (const row of movementRows) for (const raw of [row.before_json, row.after_json]) {
        if (typeof raw !== 'string') continue;
        try {
          const value = JSON.parse(raw) as { resourceId?: unknown; resourceIds?: unknown };
          if (typeof value?.resourceId === 'string') resourceIds.add(value.resourceId);
          if (Array.isArray(value?.resourceIds)) for (const resourceId of value.resourceIds)
            if (typeof resourceId === 'string') resourceIds.add(resourceId);
        } catch { /* Un movimiento de una versión anterior puede no contener JSON. */ }
      }
      const deleteTriggers = [
        ['movements_no_delete', "CREATE TRIGGER movements_no_delete BEFORE DELETE ON movements BEGIN SELECT RAISE(ABORT, 'El historial es inmutable'); END;"],
        ['movement_numbers_no_delete', "CREATE TRIGGER movement_numbers_no_delete BEFORE DELETE ON movement_numbers BEGIN SELECT RAISE(ABORT, 'El historial es inmutable'); END;"],
        ['closures_no_delete', "CREATE TRIGGER closures_no_delete BEFORE DELETE ON closures BEGIN SELECT RAISE(ABORT,'El cierre es inmutable'); END;"],
        ['draws_no_delete', "CREATE TRIGGER draws_no_delete BEFORE DELETE ON draws BEGIN SELECT RAISE(ABORT,'La extracción es inmutable'); END;"],
      ] as const;
      for (const [name] of deleteTriggers) {
        if (!(await tx.query("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?;", [name])).length)
          throw new Error('Falta una protección de historial. No se eliminó el sorteo.');
        await tx.execute(`DROP TRIGGER ${name};`);
      }
      await tx.run('DELETE FROM results WHERE raffle_id=?;', [id]);
      await tx.run('DELETE FROM draws WHERE raffle_id=?;', [id]);
      await tx.run('DELETE FROM closures WHERE raffle_id=?;', [id]);
      await tx.run('DELETE FROM generated_sets WHERE raffle_id=?;', [id]);
      await tx.run('DELETE FROM movement_numbers WHERE raffle_id=?;', [id]);
      await tx.run("DELETE FROM movements WHERE entity_type='sorteo' AND entity_id=?;", [id]);
      await tx.run('DELETE FROM operation_items WHERE raffle_id=?;', [id]);
      await tx.run('DELETE FROM raffle_numbers WHERE raffle_id=?;', [id]);
      await tx.run('DELETE FROM operations WHERE raffle_id=?;', [id]);
      await tx.run('DELETE FROM graphic_configurations WHERE raffle_id=?;', [id]);
      await tx.run('DELETE FROM prizes WHERE raffle_id=?;', [id]);
      await tx.run('DELETE FROM raffles WHERE id=?;', [id]);
      for (const resourceId of resourceIds) await tx.run(`DELETE FROM resources WHERE id=?
        AND NOT EXISTS (SELECT 1 FROM graphic_configurations WHERE original_resource_id=resources.id);`, [resourceId]);
      for (const [, sql] of deleteTriggers) await tx.execute(sql);
      if ((await tx.query('PRAGMA foreign_key_check;')).length) throw new Error('No se pudo verificar la eliminación. El sorteo sigue intacto.');
    });
  }

  async saveRaffle(input: RaffleDetails, initialNotes = ''): Promise<RaffleDetails> {
    const value = structuredClone(input);
    value.raffle.name = value.raffle.name.trim();
    value.raffle.description = value.raffle.description.trim();
    value.raffle.publicContact = value.raffle.publicContact.trim();
    value.raffle.drawMethod = value.raffle.drawMethod.trim();
    value.raffle.unsoldRule = value.raffle.participants === 'todos' ? value.raffle.unsoldRule?.trim() || null : null;
    value.prizes = value.prizes.map((p, i) => ({ ...p, raffleId: value.raffle.id, position: i + 1, description: p.description.trim(), image: p.image ?? null }));
    validateDetails(value);
    if (initialNotes.length > 12000) throw new Error('Las aclaraciones admiten hasta 12.000 caracteres.');
    return this.db.transaction(async tx => {
      const id = value.raffle.id;
      const exists = (await tx.query('SELECT id FROM raffles WHERE id = ?;', [id])).length > 0;
      const before = exists ? await details(tx, id) : null;
      if (value.raffle.participants === 'todos' && !unsoldPolicy(value.raffle.unsoldRule) && !before?.locked)
        throw new Error('Elegí premio vacante o repetir extracción externa para un número sin comprador.');
      if ((before?.revision ?? 0) !== value.revision) throw new Error('Los datos cambiaron. Volvé a abrir el sorteo antes de editar.');
      if (before && !['borrador', 'activo', 'pausado'].includes(before.raffle.status)) throw new Error('Este sorteo ya no admite edición.');
      if (before?.locked && conditions(before) !== conditions(value))
        throw new Error('Ya existen operaciones: no se pueden cambiar números, precio, premios ni condiciones.');
      value.raffle.status = before?.raffle.status ?? 'borrador';
      value.raffle.createdAt = before?.raffle.createdAt ?? new Date().toISOString();
      value.raffle.updatedAt = new Date().toISOString();
      if (!before) await insertRaffle(tx, value.raffle);
      else {
        if (!before.locked) await tx.run(`DELETE FROM raffle_numbers WHERE raffle_id = ? AND
          (value < ? OR value > ?) AND status = 'disponible';`, [id, value.raffle.startNumber, value.raffle.startNumber + (value.raffle.quantity - 1)]);
        const r = value.raffle;
        await tx.run(`UPDATE raffles SET name=?, description=?, public_contact=?, start_number=?, quantity=?,
          unit_price_cents=?, draw_at=?, draw_method=?, participants=?, unsold_rule=?, updated_at=?, revision=revision+1 WHERE id=?;`,
        [r.name, r.description, r.publicContact, r.startNumber, r.quantity, r.unitPriceCents, r.drawAt, r.drawMethod,
          r.participants, r.unsoldRule, r.updatedAt, id]);
      }
      const previousPrizeResources = new Map((await tx.query('SELECT id,image_resource_id FROM prizes WHERE raffle_id=?;', [id]))
        .map(row => [String(row.id), row.image_resource_id === null ? null : String(row.image_resource_id)]));
      const prizeResourceIds: string[] = [];
      if (!before?.locked) {
        await tx.run('DELETE FROM prizes WHERE raffle_id = ?;', [id]);
      }
      for (const p of value.prizes) {
        const previous = before?.prizes.find(prize => prize.id === p.id);
        let prizeResourceId = previousPrizeResources.get(p.id) ?? null;
        if (!p.image) prizeResourceId = null;
        else if (p.image !== previous?.image) {
          prizeResourceId = crypto.randomUUID();
          await tx.run('INSERT INTO resources (id, data_url, created_at) VALUES (?, ?, ?);', [prizeResourceId, p.image, value.raffle.updatedAt]);
        }
        if (prizeResourceId) prizeResourceIds.push(prizeResourceId);
        if (!before?.locked) await tx.run('INSERT INTO prizes (id, raffle_id, position, description, image_resource_id) VALUES (?, ?, ?, ?, ?);',
          [p.id, id, p.position, p.description, prizeResourceId]);
        else await tx.run('UPDATE prizes SET image_resource_id=? WHERE id=? AND raffle_id=?;', [prizeResourceId, p.id, id]);
      }
      const previousResourceId = (await tx.query('SELECT original_resource_id FROM graphic_configurations WHERE raffle_id=?;', [id]))[0]?.original_resource_id ?? null;
      let resourceId = previousResourceId;
      if (!value.image) resourceId = null;
      else if (value.image !== before?.image) {
        resourceId = crypto.randomUUID();
        await tx.run('INSERT INTO resources (id, data_url, created_at) VALUES (?, ?, ?);', [resourceId, value.image, value.raffle.updatedAt]);
      }
      await tx.run(`INSERT INTO graphic_configurations (raffle_id, template, palette, original_resource_id, conditions_notes)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(raffle_id) DO UPDATE SET template=excluded.template,
        palette=excluded.palette, original_resource_id=excluded.original_resource_id, generated_at=NULL, dirty=1;`,
      [id, value.template, value.palette, resourceId, initialNotes.trim()]);
      const saved = await details(tx, id);
      await audit(tx, 'sorteo', id, before ? 'editar_configuracion' : 'crear',
        before ? { ...withoutImage(before), resourceId: previousResourceId, resourceIds: [...previousPrizeResources.values()].filter(Boolean) } : null,
        { ...withoutImage(saved), resourceId, resourceIds: prizeResourceIds, ...(!before ? { conditionsNotes: initialNotes.trim() } : {}) });
      return saved;
    });
  }

  async duplicateRaffle(id: string): Promise<RaffleDetails> {
    const { value, notes } = await this.db.read(async tx => ({ value: await details(tx, id),
      notes: String((await tx.query('SELECT conditions_notes FROM graphic_configurations WHERE raffle_id=?;', [id]))[0]?.conditions_notes ?? '') }));
    value.raffle.id = crypto.randomUUID();
    value.raffle.name = `${value.raffle.name} (copia)`;
    value.raffle.status = 'borrador';
    value.prizes = value.prizes.map(p => ({ ...p, id: crypto.randomUUID(), raffleId: value.raffle.id }));
    value.revision = 0; value.locked = false;
    return this.saveRaffle(value, notes);
  }

  async setSalesState(id: string, revision: number, status: 'activo' | 'pausado'): Promise<RaffleDetails> {
    return this.db.transaction(async tx => {
      const before = await details(tx, id);
      if (before.revision !== revision) throw new Error('Los datos cambiaron. Volvé a abrir el sorteo.');
      const allowed = (status === 'activo' && ['borrador', 'pausado'].includes(before.raffle.status)) ||
        (status === 'pausado' && before.raffle.status === 'activo');
      if (!allowed) throw new Error('No se puede realizar este cambio de estado.');
      validateDetails(before);
      await tx.run('UPDATE raffles SET status=?, updated_at=?, revision=revision+1 WHERE id=?;', [status, new Date().toISOString(), id]);
      await tx.run('UPDATE graphic_configurations SET dirty=1,generated_at=NULL WHERE raffle_id=?;', [id]);
      const after = await details(tx, id);
      await audit(tx, 'sorteo', id, status === 'activo' ? 'activar' : 'pausar', before.raffle.status, status);
      return after;
    });
  }

  async listBuyers(query = ''): Promise<BuyerRecord[]> {
    return this.db.read(async tx => {
      const numbers = await tx.query('SELECT buyer_id, value FROM raffle_numbers WHERE buyer_id IS NOT NULL ORDER BY value;');
      const assigned = new Map<string, number[]>();
      for (const n of numbers) assigned.set(String(n.buyer_id), [...(assigned.get(String(n.buyer_id)) ?? []), Number(n.value)]);
      const rows = await tx.query('SELECT * FROM buyers;');
      return searchBuyers(rows.map(b => ({ id: String(b.id), phone: String(b.phone), phoneKey: String(b.phone_key),
        firstName: String(b.first_name), lastName: String(b.last_name), email: b.email === null ? null : String(b.email),
        notes: String(b.notes), createdAt: String(b.created_at), updatedAt: String(b.updated_at), revision: Number(b.revision),
        assignedNumbers: assigned.get(String(b.id)) ?? [] })), query);
    });
  }

  async saveBuyer(input: BuyerInput, existing?: Pick<BuyerRecord, 'id' | 'revision'>): Promise<string> {
    const value = validateBuyer(input);
    return this.db.transaction(async tx => {
      const id = existing?.id ?? crypto.randomUUID();
      const before = (await tx.query('SELECT * FROM buyers WHERE id=?;', [id]))[0];
      if (existing && (!before || Number(before.revision) !== existing.revision))
        throw new Error('Los datos cambiaron. Volvé a abrir el comprador.');
      const now = new Date().toISOString();
      const fields = [value.phone, normalizePhone(value.phone), value.firstName, value.lastName, value.email, value.notes, now];
      if (before) await tx.run(`UPDATE buyers SET phone=?, phone_key=?, first_name=?, last_name=?, email=?, notes=?,
        updated_at=?, revision=revision+1 WHERE id=?;`, [...fields, id]);
      else await tx.run(`INSERT INTO buyers (phone,phone_key,first_name,last_name,email,notes,updated_at,id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?);`, [...fields, id, now]);
      await audit(tx, 'comprador', id, before ? 'editar' : 'crear', before ?? null, value);
      return id;
    });
  }
}
