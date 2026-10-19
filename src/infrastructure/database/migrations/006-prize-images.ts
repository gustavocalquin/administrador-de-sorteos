export const prizeImagesSchema = `
ALTER TABLE prizes ADD COLUMN image_resource_id TEXT REFERENCES resources(id) ON DELETE RESTRICT;
`;
