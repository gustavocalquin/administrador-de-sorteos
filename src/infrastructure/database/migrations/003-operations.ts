export const operationsSchema = `
ALTER TABLE raffle_numbers ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);
ALTER TABLE graphic_configurations ADD COLUMN dirty INTEGER NOT NULL DEFAULT 1 CHECK(dirty IN (0,1));
CREATE TABLE movement_numbers (
  movement_id TEXT NOT NULL REFERENCES movements(id) ON DELETE RESTRICT,
  raffle_id TEXT NOT NULL REFERENCES raffles(id) ON DELETE RESTRICT,
  value INTEGER NOT NULL,
  PRIMARY KEY(movement_id, raffle_id, value)
);
CREATE INDEX idx_movement_numbers_lookup ON movement_numbers(raffle_id, value);
CREATE TRIGGER movement_numbers_no_update BEFORE UPDATE ON movement_numbers
BEGIN SELECT RAISE(ABORT, 'El historial es inmutable'); END;
CREATE TRIGGER movement_numbers_no_delete BEFORE DELETE ON movement_numbers
BEGIN SELECT RAISE(ABORT, 'El historial es inmutable'); END;
`;
