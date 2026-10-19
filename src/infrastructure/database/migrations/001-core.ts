export const coreSchema = `
CREATE TABLE raffles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  public_contact TEXT NOT NULL DEFAULT '',
  start_number INTEGER NOT NULL CHECK(typeof(start_number) = 'integer' AND abs(start_number) <= 9007199254740991),
  quantity INTEGER NOT NULL CHECK(typeof(quantity) = 'integer' AND quantity > 0 AND quantity <= 9007199254740991),
  unit_price_cents INTEGER NOT NULL CHECK(typeof(unit_price_cents) = 'integer' AND unit_price_cents >= 0 AND unit_price_cents <= 9007199254740991),
  currency TEXT NOT NULL DEFAULT 'ARS' CHECK(currency = 'ARS'),
  draw_at TEXT,
  draw_method TEXT NOT NULL DEFAULT '',
  participants TEXT NOT NULL CHECK(participants IN ('todos', 'solo_vendidos')),
  unsold_rule TEXT,
  status TEXT NOT NULL CHECK(status IN ('borrador','activo','pausado','ventas_cerradas','sorteado','archivado')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(abs(start_number + quantity - 1) <= 9007199254740991),
  CHECK(unit_price_cents * quantity <= 9007199254740991)
);
CREATE TABLE buyers (
  id TEXT PRIMARY KEY NOT NULL,
  phone TEXT NOT NULL CHECK(length(trim(phone)) > 0),
  phone_key TEXT NOT NULL CHECK(length(trim(phone_key)) > 0),
  first_name TEXT NOT NULL CHECK(length(trim(first_name)) > 0),
  last_name TEXT NOT NULL CHECK(length(trim(last_name)) > 0),
  email TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_buyers_phone ON buyers(phone_key);
CREATE INDEX idx_buyers_name ON buyers(last_name, first_name);
CREATE TABLE prizes (
  id TEXT PRIMARY KEY NOT NULL,
  raffle_id TEXT NOT NULL REFERENCES raffles(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK(typeof(position) = 'integer' AND position > 0),
  description TEXT NOT NULL CHECK(length(trim(description)) > 0),
  UNIQUE(raffle_id, position)
);
CREATE TABLE operations (
  id TEXT PRIMARY KEY NOT NULL,
  raffle_id TEXT NOT NULL REFERENCES raffles(id) ON DELETE RESTRICT,
  buyer_id TEXT NOT NULL REFERENCES buyers(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK(type IN ('reserva','venta','pago')),
  status TEXT NOT NULL CHECK(status IN ('vigente','parcial','completada','anulada')),
  amount_cents INTEGER NOT NULL CHECK(typeof(amount_cents) = 'integer' AND amount_cents >= 0 AND amount_cents <= 9007199254740991),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, raffle_id),
  UNIQUE(id, raffle_id, buyer_id)
);
CREATE INDEX idx_operations_raffle ON operations(raffle_id);
CREATE TABLE raffle_numbers (
  id TEXT PRIMARY KEY NOT NULL,
  raffle_id TEXT NOT NULL REFERENCES raffles(id) ON DELETE RESTRICT,
  value INTEGER NOT NULL CHECK(typeof(value) = 'integer' AND abs(value) <= 9007199254740991),
  status TEXT NOT NULL CHECK(status IN ('disponible','reservado','vendido')),
  buyer_id TEXT REFERENCES buyers(id) ON DELETE RESTRICT,
  active_operation_id TEXT,
  UNIQUE(raffle_id, value),
  UNIQUE(id, raffle_id),
  FOREIGN KEY(active_operation_id, raffle_id, buyer_id) REFERENCES operations(id, raffle_id, buyer_id) ON DELETE RESTRICT,
  CHECK((status = 'disponible' AND buyer_id IS NULL AND active_operation_id IS NULL)
     OR (status IN ('reservado','vendido') AND buyer_id IS NOT NULL AND active_operation_id IS NOT NULL))
);
CREATE INDEX idx_numbers_raffle_status ON raffle_numbers(raffle_id, status);
CREATE TRIGGER number_range_insert BEFORE INSERT ON raffle_numbers
WHEN NOT EXISTS (SELECT 1 FROM raffles WHERE id = NEW.raffle_id AND NEW.value BETWEEN start_number AND start_number + quantity - 1)
BEGIN SELECT RAISE(ABORT, 'Numero fuera del rango'); END;
CREATE TRIGGER number_range_update BEFORE UPDATE OF value, raffle_id ON raffle_numbers
WHEN NOT EXISTS (SELECT 1 FROM raffles WHERE id = NEW.raffle_id AND NEW.value BETWEEN start_number AND start_number + quantity - 1)
BEGIN SELECT RAISE(ABORT, 'Numero fuera del rango'); END;
CREATE TRIGGER raffle_range_update BEFORE UPDATE OF start_number, quantity ON raffles
WHEN EXISTS (SELECT 1 FROM raffle_numbers WHERE raffle_id = NEW.id AND (value < NEW.start_number OR value > NEW.start_number + NEW.quantity - 1))
BEGIN SELECT RAISE(ABORT, 'El rango excluiria numeros existentes'); END;
CREATE TABLE operation_items (
  operation_id TEXT NOT NULL,
  number_id TEXT NOT NULL,
  raffle_id TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK(typeof(unit_price_cents) = 'integer' AND unit_price_cents >= 0 AND unit_price_cents <= 9007199254740991),
  status TEXT NOT NULL CHECK(status IN ('reservado','pagado','cancelado')),
  PRIMARY KEY(operation_id, number_id),
  FOREIGN KEY(operation_id, raffle_id) REFERENCES operations(id, raffle_id) ON DELETE RESTRICT,
  FOREIGN KEY(number_id, raffle_id) REFERENCES raffle_numbers(id, raffle_id) ON DELETE RESTRICT
);
CREATE INDEX idx_items_number ON operation_items(number_id);
CREATE TABLE movements (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_movements_entity ON movements(entity_type, entity_id, created_at);
CREATE TRIGGER movements_no_update BEFORE UPDATE ON movements
BEGIN SELECT RAISE(ABORT, 'El historial es inmutable'); END;
CREATE TRIGGER movements_no_delete BEFORE DELETE ON movements
BEGIN SELECT RAISE(ABORT, 'El historial es inmutable'); END;
`;
