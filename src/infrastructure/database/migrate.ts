import type { SqlDriver } from './driver';
import { coreSchema } from './migrations/001-core';
import { catalogSchema } from './migrations/002-catalog';
import { operationsSchema } from './migrations/003-operations';
import { graphicsSchema } from './migrations/004-graphics';
import { closingBackupsSchema } from './migrations/005-closing-backups';
import { prizeImagesSchema } from './migrations/006-prize-images';
import { moreTemplatesSchema } from './migrations/007-more-templates';

export interface Migration { version: number; sql: string }
export const migrations: readonly Migration[] = [{ version: 1, sql: coreSchema }, { version: 2, sql: catalogSchema }, { version: 3, sql: operationsSchema }, { version: 4, sql: graphicsSchema }, { version: 5, sql: closingBackupsSchema }, { version: 6, sql: prizeImagesSchema }, { version: 7, sql: moreTemplatesSchema }];

export async function migrate(driver: SqlDriver, steps: readonly Migration[] = migrations): Promise<void> {
  if (steps.some((step, index) => step.version !== index + 1)) throw new Error('Secuencia de migraciones inválida.');
  const version = Number((await driver.query('PRAGMA user_version;'))[0]?.user_version);
  if (!Number.isInteger(version) || version < 0) throw new Error('No se pudo leer la versión de la base.');
  if (version > steps.length) throw new Error('Esta base fue creada con una versión más nueva. Actualizá la aplicación.');
  await driver.execute('PRAGMA foreign_keys = ON;');
  if (Number((await driver.query('PRAGMA foreign_keys;'))[0]?.foreign_keys) !== 1)
    throw new Error('No se pudo activar la integridad de la base.');

  const pending = steps.filter(step => step.version > version);
  if (pending.length === 0) return;
  await driver.begin();
  try {
    for (const step of pending) {
      await driver.execute(step.sql);
      await driver.execute(`PRAGMA user_version = ${step.version};`);
    }
    if ((await driver.query('PRAGMA foreign_key_check;')).length) throw new Error('La migración dejó referencias inválidas.');
    await driver.commit();
  } catch (error) {
    try { await driver.rollback(); }
    catch (rollbackError) { throw new AggregateError([error, rollbackError], 'No se pudo revertir la migración.', { cause: rollbackError }); }
    throw error;
  }
}
