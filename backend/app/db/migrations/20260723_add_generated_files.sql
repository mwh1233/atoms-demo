ALTER TABLE projects
ADD COLUMN IF NOT EXISTS generated_files jsonb DEFAULT '{}'::jsonb;
