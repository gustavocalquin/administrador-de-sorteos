export const graphicsSchema = `
ALTER TABLE graphic_configurations ADD COLUMN conditions_notes TEXT NOT NULL DEFAULT '';
CREATE TABLE generated_sets (
  raffle_id TEXT PRIMARY KEY NOT NULL REFERENCES raffles(id) ON DELETE RESTRICT,
  id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL,
  generated_at TEXT NOT NULL
);
CREATE TABLE generated_images (
  set_id TEXT NOT NULL REFERENCES generated_sets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('grid','conditions')),
  title TEXT NOT NULL,
  data_url TEXT NOT NULL,
  PRIMARY KEY(set_id,position)
);
`;
