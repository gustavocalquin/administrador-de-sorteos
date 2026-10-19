export const moreTemplatesSchema = `
CREATE TABLE graphic_configurations_next (
  raffle_id TEXT PRIMARY KEY NOT NULL REFERENCES raffles(id) ON DELETE RESTRICT,
  template TEXT NOT NULL CHECK(template IN ('clasica','moderna','festiva','minimalista','elegante','colorida')),
  palette TEXT NOT NULL CHECK(palette IN ('bosque','oceano','ciruela')),
  original_resource_id TEXT REFERENCES resources(id) ON DELETE RESTRICT,
  generated_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1 CHECK(dirty IN (0,1)),
  conditions_notes TEXT NOT NULL DEFAULT ''
);
INSERT INTO graphic_configurations_next
  (raffle_id,template,palette,original_resource_id,generated_at,dirty,conditions_notes)
SELECT raffle_id,template,palette,original_resource_id,generated_at,dirty,conditions_notes
FROM graphic_configurations;
DROP TABLE graphic_configurations;
ALTER TABLE graphic_configurations_next RENAME TO graphic_configurations;
`;
