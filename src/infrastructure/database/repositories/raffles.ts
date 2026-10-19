import { validateRaffle, type Raffle } from '../../../domain/models';
import type { RaffleRepository } from '../../../domain/repositories';
import { Database, type SqlRow, type SqlSession } from '../driver';

export function mapRaffle(row: SqlRow): Raffle {
  return {
    id: String(row.id), name: String(row.name), description: String(row.description),
    publicContact: String(row.public_contact), startNumber: Number(row.start_number),
    quantity: Number(row.quantity), unitPriceCents: Number(row.unit_price_cents), currency: 'ARS',
    drawAt: row.draw_at === null ? null : String(row.draw_at), drawMethod: String(row.draw_method),
    participants: row.participants as Raffle['participants'], unsoldRule: row.unsold_rule === null ? null : String(row.unsold_rule),
    status: row.status as Raffle['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export class SqliteRaffleRepository implements RaffleRepository {
  constructor(private readonly db: Database) {}
  list(): Promise<Raffle[]> {
    return this.db.read(async session => (await session.query('SELECT * FROM raffles ORDER BY created_at DESC, id;')).map(mapRaffle));
  }
  findById(id: string): Promise<Raffle | null> {
    return this.db.read(async session => {
      const row = (await session.query('SELECT * FROM raffles WHERE id = ?;', [id]))[0];
      return row ? mapRaffle(row) : null;
    });
  }
}

/** Persistence primitive, used by diagnostics now and application cases in stage 2. */
export async function insertRaffle(session: SqlSession, raffle: Raffle): Promise<void> {
  validateRaffle(raffle);
  await session.run(`INSERT INTO raffles
    (id, name, description, public_contact, start_number, quantity, unit_price_cents,
     currency, draw_at, draw_method, participants, unsold_rule, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
  [raffle.id, raffle.name, raffle.description, raffle.publicContact, raffle.startNumber,
    raffle.quantity, raffle.unitPriceCents, raffle.currency, raffle.drawAt, raffle.drawMethod,
    raffle.participants, raffle.unsoldRule, raffle.status, raffle.createdAt, raffle.updatedAt]);
}
