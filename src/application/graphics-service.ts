import type { RaffleDetails } from '../domain/catalog';
import { validateImages, type GraphicImage, type GraphicSet, type PublicRaffle } from '../domain/graphics';
import type { NumberStatus } from '../domain/models';
import { Database, type SqlSession } from '../infrastructure/database/driver';

export class GraphicsService {
  constructor(private readonly db: Database, private readonly details: (tx: SqlSession, id: string) => Promise<RaffleDetails>) {}
  snapshot(id: string): Promise<PublicRaffle> {
    return this.db.read(async tx => {
      const d = await this.details(tx, id); const r = d.raffle;
      const notes = (await tx.query('SELECT conditions_notes FROM graphic_configurations WHERE raffle_id=?;', [id]))[0]?.conditions_notes ?? '';
      const rows = await tx.query("SELECT value,status FROM raffle_numbers WHERE raffle_id=? AND status<>'disponible' ORDER BY value;", [id]);
      return { id, revision: d.revision, name: r.name, description: r.description, contact: r.publicContact,
        start: r.startNumber, quantity: r.quantity, price: r.unitPriceCents, drawAt: r.drawAt, method: r.drawMethod,
        participants: r.participants, unsoldRule: r.unsoldRule, status: r.status,
        prizes: d.prizes.map(p => ({ description: p.description, image: p.image ?? null })),
        template: d.template, palette: d.palette, image: d.image, notes: String(notes),
        numbers: rows.map(n => ({ value: Number(n.value), status: n.status as NumberStatus })) };
    });
  }
  saveNotes(id: string, revision: number, notes: string): Promise<void> {
    return this.db.transaction(async tx => {
      const d = await this.details(tx, id);
      if (d.revision !== revision) throw new Error('El sorteo cambió. Volvé a abrir Imágenes.');
      const before = String((await tx.query('SELECT conditions_notes FROM graphic_configurations WHERE raffle_id=?;', [id]))[0]?.conditions_notes ?? '');
      notes = notes.trim();
      if (notes === before) return;
      if (d.locked || !['borrador', 'activo', 'pausado'].includes(d.raffle.status)) throw new Error('Ya hay operaciones: las bases están protegidas.');
      if (notes.length > 12000) throw new Error('Las aclaraciones admiten hasta 12.000 caracteres.');
      const now = new Date().toISOString();
      await tx.run('UPDATE graphic_configurations SET conditions_notes=?,dirty=1,generated_at=NULL WHERE raffle_id=?;', [notes, id]);
      await tx.run('UPDATE raffles SET revision=revision+1,updated_at=? WHERE id=?;', [now, id]);
      await tx.run("INSERT INTO movements(id,entity_type,entity_id,action,before_json,after_json,created_at) VALUES (?,'sorteo',?,'editar_bases',?,?,?);", [crypto.randomUUID(), id, JSON.stringify(before), JSON.stringify(notes), now]);
    });
  }
  get(id: string): Promise<GraphicSet | null> {
    return this.db.read(async tx => {
      const row = (await tx.query('SELECT * FROM generated_sets WHERE raffle_id=?;', [id]))[0];
      if (!row) return null;
      const images = await tx.query('SELECT * FROM generated_images WHERE set_id=? ORDER BY position;', [String(row.id)]);
      return { id: String(row.id), revision: Number(row.revision), generatedAt: String(row.generated_at),
        images: images.map(p => ({ kind: p.kind as GraphicImage['kind'], title: String(p.title), dataUrl: String(p.data_url) })) };
    });
  }
  save(id: string, revision: number, images: GraphicImage[]): Promise<GraphicSet> {
    validateImages(images);
    return this.db.transaction(async tx => {
      const d = await this.details(tx, id);
      if (d.revision !== revision) throw new Error('El sorteo cambió mientras se generaban las imágenes. Generá de nuevo para incluir los cambios.');
      const result = { id: crypto.randomUUID(), revision, generatedAt: new Date().toISOString(), images };
      await tx.run('DELETE FROM generated_sets WHERE raffle_id=?;', [id]);
      await tx.run('INSERT INTO generated_sets(raffle_id,id,revision,generated_at) VALUES (?,?,?,?);', [id, result.id, revision, result.generatedAt]);
      for (const [i, p] of images.entries()) await tx.run('INSERT INTO generated_images(set_id,position,kind,title,data_url) VALUES (?,?,?,?,?);', [result.id, i, p.kind, p.title, p.dataUrl]);
      await tx.run('UPDATE graphic_configurations SET dirty=0,generated_at=? WHERE raffle_id=?;', [result.generatedAt, id]);
      return result;
    });
  }
  assertCurrent(id: string, setId: string): Promise<void> {
    return this.db.read(async tx => {
      const row = (await tx.query(`SELECT s.id,s.revision,r.revision AS current_revision,g.dirty FROM generated_sets s
        JOIN raffles r ON r.id=s.raffle_id JOIN graphic_configurations g ON g.raffle_id=r.id WHERE r.id=?;`, [id]))[0];
      if (!row || row.id !== setId || row.revision !== row.current_revision || row.dirty !== 0)
        throw new Error('Imagen desactualizada. Generá una nueva antes de compartir o exportar.');
    });
  }
}
