ALTER TABLE projects
ADD COLUMN IF NOT EXISTS architecture_doc text;

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS file_tree_plan jsonb DEFAULT '[]'::jsonb;
