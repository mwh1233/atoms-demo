-- ========================================
-- Atoms Demo 完整数据库初始化 SQL (MemFireDB / Supabase 兼容)
-- ========================================

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========================================
-- 1. projects 表（项目表）
-- ========================================
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  initial_prompt text,
  generated_code text,
  generated_files jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  current_step text,
  error_message text,
  deploy_status text DEFAULT 'not_deployed',
  deployed_url text,
  deployed_at timestamptz,
  analysis_result text,
  design_result text,
  architecture_doc text,
  file_tree_plan jsonb DEFAULT '[]'::jsonb,
  template_id text DEFAULT 'fullstack-shadcn',
  iteration_count integer DEFAULT 0,
  features_list jsonb DEFAULT '[]'::jsonb,
  confirmed_features jsonb DEFAULT '[]'::jsonb,
  build_attempts integer DEFAULT 0,
  build_error text,
  build_success boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- status 字段约束
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
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

-- 索引
CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects(user_id);
CREATE INDEX IF NOT EXISTS projects_status_idx ON projects(status);
CREATE INDEX IF NOT EXISTS projects_created_at_idx ON projects(created_at DESC);

-- 自动更新 updated_at 触发器
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ========================================
-- 2. messages 表（对话消息表）
-- ========================================
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  step text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_project_id_idx ON messages(project_id);
CREATE INDEX IF NOT EXISTS messages_project_created_idx ON messages(project_id, created_at);

-- ========================================
-- 3. templates 表（模板表）
-- ========================================
CREATE TABLE IF NOT EXISTS templates (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  tech_stack jsonb DEFAULT '[]'::jsonb,
  preview_image text,
  is_default boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 预置模板数据
INSERT INTO templates (id, name, description, tech_stack, is_default)
VALUES
  ('fullstack-shadcn', '企业级全栈模板', 'React + TypeScript + TailwindCSS + shadcn/ui', '["React", "TypeScript", "TailwindCSS", "shadcn/ui", "Vite"]'::jsonb, true),
  ('simple-html', '简单HTML模板', '单文件HTML + TailwindCSS CDN', '["HTML", "TailwindCSS"]'::jsonb, false),
  ('fullstack-agent', '基础全栈模板', 'React + FastAPI', '["React", "FastAPI"]'::jsonb, false)
ON CONFLICT (id) DO NOTHING;

-- ========================================
-- 4. RLS (行级安全策略)
-- ========================================
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

-- projects 表策略：用户只能看自己的项目
DROP POLICY IF EXISTS "Users can view their own projects" ON projects;
CREATE POLICY "Users can view their own projects" ON projects
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own projects" ON projects;
CREATE POLICY "Users can insert their own projects" ON projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own projects" ON projects;
CREATE POLICY "Users can update their own projects" ON projects
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own projects" ON projects;
CREATE POLICY "Users can delete their own projects" ON projects
  FOR DELETE USING (auth.uid() = user_id);

-- messages 表策略：通过project关联验证用户
DROP POLICY IF EXISTS "Users can view messages of their projects" ON messages;
CREATE POLICY "Users can view messages of their projects" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = messages.project_id
      AND projects.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert messages to their projects" ON messages;
CREATE POLICY "Users can insert messages to their projects" ON messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = messages.project_id
      AND projects.user_id = auth.uid()
    )
  );

-- templates 表策略：所有登录用户可读
DROP POLICY IF EXISTS "Templates are viewable by everyone" ON templates;
CREATE POLICY "Templates are viewable by everyone" ON templates
  FOR SELECT USING (true);

-- ========================================
-- 5. Storage 存储桶
-- ========================================
-- 注意：存储桶需要在MemFireDB控制台手动创建，或使用以下SQL（如果支持）
-- 创建 deployed-projects 桶，设为公开访问
INSERT INTO storage.buckets (id, name, public)
VALUES ('deployed-projects', 'deployed-projects', true)
ON CONFLICT (id) DO NOTHING;

-- 存储策略：用户可以上传自己项目的文件
DROP POLICY IF EXISTS "Users can upload project files" ON storage.objects;
CREATE POLICY "Users can upload project files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'deployed-projects'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Project files are publicly accessible" ON storage.objects;
CREATE POLICY "Project files are publicly accessible" ON storage.objects
  FOR SELECT USING (bucket_id = 'deployed-projects');

-- ========================================
-- 完成
-- ========================================
