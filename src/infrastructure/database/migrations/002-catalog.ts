export const catalogSchema = `
ALTER TABLE raffles ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE buyers ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE TABLE resources (
  id TEXT PRIMARY KEY NOT NULL,
  data_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE graphic_configurations (
  raffle_id TEXT PRIMARY KEY NOT NULL REFERENCES raffles(id) ON DELETE RESTRICT,
  template TEXT NOT NULL CHECK(template IN ('clasica','moderna','festiva')),
  palette TEXT NOT NULL CHECK(palette IN ('bosque','oceano','ciruela')),
  original_resource_id TEXT REFERENCES resources(id) ON DELETE RESTRICT,
  generated_at TEXT
);
INSERT INTO graphic_configurations (raffle_id, template, palette)
SELECT id, 'clasica', 'bosque' FROM raffles;
`;
