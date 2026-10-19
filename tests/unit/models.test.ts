import { expect, it } from 'vitest';
import { validateRaffle } from '../../src/domain/models';
import { diagnosticRaffle } from '../../src/dev/diagnostic-service';

it('valida rangos e importes seguros y mantiene cero como número válido', () => {
  expect(() => validateRaffle(diagnosticRaffle())).not.toThrow();
  for (const invalid of [
    { quantity: 0 }, { startNumber: 0.5 }, { startNumber: Number.MAX_SAFE_INTEGER, quantity: 2 },
    { unitPriceCents: -1 }, { unitPriceCents: 1.5 }, { unitPriceCents: Number.MAX_SAFE_INTEGER, quantity: 2 }, { name: ' ' },
  ]) expect(() => validateRaffle({ ...diagnosticRaffle(), ...invalid })).toThrow();
});
