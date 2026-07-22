ALTER TABLE projects
ADD COLUMN IF NOT EXISTS template_id text DEFAULT 'fullstack-shadcn';

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS template_code jsonb DEFAULT '{}'::jsonb;
