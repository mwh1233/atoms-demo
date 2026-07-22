ALTER TABLE projects
ADD COLUMN IF NOT EXISTS features_list jsonb DEFAULT '[]'::jsonb;

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS confirmed_features jsonb DEFAULT '[]'::jsonb;

ALTER TABLE projects
DROP CONSTRAINT IF EXISTS projects_status_check;

ALTER TABLE projects
ADD CONSTRAINT projects_status_check
CHECK (
  status IN (
    'pending',
    'generating',
    'awaiting_features_confirmation',
    'awaiting_confirmation',
    'completed',
    'failed'
  )
);
