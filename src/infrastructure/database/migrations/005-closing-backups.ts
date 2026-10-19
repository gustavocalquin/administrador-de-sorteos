export const closingBackupsSchema = `
CREATE TABLE closures (
  id TEXT PRIMARY KEY NOT NULL,
  raffle_id TEXT NOT NULL REFERENCES raffles(id) ON DELETE RESTRICT,
  closed_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  UNIQUE(id,raffle_id)
);
CREATE TABLE draws (
  id TEXT PRIMARY KEY NOT NULL,
  raffle_id TEXT NOT NULL REFERENCES raffles(id) ON DELETE RESTRICT,
  closure_id TEXT NOT NULL,
  prize_id TEXT NOT NULL REFERENCES prizes(id) ON DELETE RESTRICT,
  number INTEGER NOT NULL CHECK(typeof(number)='integer'),
  outcome TEXT NOT NULL CHECK(outcome IN ('ganador','vacante','repetir','correccion')),
  reason TEXT,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY(closure_id,raffle_id) REFERENCES closures(id,raffle_id)
);
CREATE TABLE results (
  prize_id TEXT PRIMARY KEY NOT NULL REFERENCES prizes(id) ON DELETE RESTRICT,
  raffle_id TEXT NOT NULL REFERENCES raffles(id) ON DELETE RESTRICT,
  closure_id TEXT NOT NULL,
  number INTEGER NOT NULL CHECK(typeof(number)='integer'),
  buyer_json TEXT,
  recorded_at TEXT NOT NULL,
  UNIQUE(raffle_id,number),
  FOREIGN KEY(closure_id,raffle_id) REFERENCES closures(id,raffle_id)
);
CREATE TRIGGER closures_no_update BEFORE UPDATE ON closures
BEGIN SELECT RAISE(ABORT,'El cierre es inmutable'); END;
CREATE TRIGGER closures_no_delete BEFORE DELETE ON closures
BEGIN SELECT RAISE(ABORT,'El cierre es inmutable'); END;
CREATE TRIGGER draws_no_update BEFORE UPDATE ON draws
BEGIN SELECT RAISE(ABORT,'La extracción es inmutable'); END;
CREATE TRIGGER draws_no_delete BEFORE DELETE ON draws
BEGIN SELECT RAISE(ABORT,'La extracción es inmutable'); END;
CREATE TABLE backup_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  exported_at TEXT,
  exported_fingerprint TEXT
);
INSERT INTO backup_state(id) VALUES(1);
CREATE TABLE backup_recovery (
  id INTEGER PRIMARY KEY CHECK(id=1),
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
`;
