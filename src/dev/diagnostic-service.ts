import type { Raffle } from '../domain/models';
import type { Database } from '../infrastructure/database/driver';
import { insertRaffle, SqliteRaffleRepository } from '../infrastructure/database/repositories/raffles';

export function diagnosticRaffle(): Raffle {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name: 'Prueba de persistencia — etapa 1', description: 'Datos sintéticos en base separada',
    publicContact: '', startNumber: 0, quantity: 3, unitPriceCents: 125050, currency: 'ARS', drawAt: null,
    drawMethod: '', participants: 'solo_vendidos', unsoldRule: null, status: 'borrador', createdAt: now, updatedAt: now };
}

export async function readDiagnostic(db: Database) {
  const raffles = await new SqliteRaffleRepository(db).list();
  const info = await db.read(async session => ({
    schemaVersion: (await session.query('PRAGMA user_version;'))[0]?.user_version,
    foreignKeys: (await session.query('PRAGMA foreign_keys;'))[0]?.foreign_keys,
    sqliteVersion: (await session.query('SELECT sqlite_version() AS version;'))[0]?.version,
    numbers: (await session.query('SELECT count(*) AS count FROM raffle_numbers;'))[0]?.count,
    movements: (await session.query('SELECT count(*) AS count FROM movements;'))[0]?.count,
  }));
  return { ...info, records: raffles };
}

export async function writeDiagnostic(db: Database) {
  await db.transaction(async session => {
    // Serialized check avoids duplicate fixture generation from rapid taps.
    if ((await session.query('SELECT id FROM raffles LIMIT 1;')).length) return;
    const raffle = diagnosticRaffle();
    await insertRaffle(session, raffle);
    for (let value = 0; value < raffle.quantity; value++) {
      await session.run('INSERT INTO raffle_numbers (id, raffle_id, value, status) VALUES (?, ?, ?, ?);',
        [crypto.randomUUID(), raffle.id, value, 'disponible']);
    }
    await session.run('INSERT INTO movements (id, entity_type, entity_id, action, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?);',
      [crypto.randomUUID(), 'sorteo', raffle.id, 'diagnostico_creado', JSON.stringify(raffle), raffle.createdAt]);
  });
  return readDiagnostic(db);
}

export async function checkRollback(db: Database): Promise<string> {
  const raffle = diagnosticRaffle();
  let rejected = false;
  let duplicateAttempted = false;
  try {
    await db.transaction(async session => {
      await insertRaffle(session, raffle);
      await session.run('INSERT INTO movements (id, entity_type, entity_id, action, created_at) VALUES (?, ?, ?, ?, ?);',
        [crypto.randomUUID(), 'sorteo', raffle.id, 'no_debe_persistir', raffle.createdAt]);
      for (let index = 0; index < 2; index++) {
        duplicateAttempted = index === 1;
        await session.run('INSERT INTO raffle_numbers (id, raffle_id, value, status) VALUES (?, ?, 0, ?);',
          [crypto.randomUUID(), raffle.id, 'disponible']);
      }
    });
  } catch (error) {
    if (!duplicateAttempted || !String(error).includes('UNIQUE constraint failed')) throw error;
    rejected = true;
  }
  if (!rejected) throw new Error('La base permitió un número duplicado.');
  const remnants = await db.read(async session => (await session.query(
    `SELECT id FROM raffles WHERE id = ? UNION ALL SELECT id FROM raffle_numbers WHERE raffle_id = ?
     UNION ALL SELECT id FROM movements WHERE entity_id = ?;`, [raffle.id, raffle.id, raffle.id])));
  if (remnants.length) throw new Error('La reversión dejó registros parciales.');
  return 'Número duplicado rechazado; sorteo, números e historial revertidos.';
}
